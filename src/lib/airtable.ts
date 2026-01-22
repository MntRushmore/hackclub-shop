import { ProjectSubmission, AirtableRecord, AirtableResponse } from '../types/Project';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY!;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID!;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'Projects';

const airtableUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encodeURIComponent(AIRTABLE_TABLE_NAME)}`;

export async function createProjectSubmission(
    submission: Omit<ProjectSubmission, 'id' | 'status' | 'submittedAt' | 'hackatimeUrl' | 'hoursApproved'>
): Promise<ProjectSubmission> {
    const response = await fetch(airtableUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            records: [
                {
                    fields: {
                        'First Name': submission.firstName,
                        'Last Name': submission.lastName,
                        Email: submission.email,
                        Address: submission.address,
                        School: submission.school,
                        'Birth Date': submission.birthDate,
                        'Slack ID': submission.slackId,
                        'GitHub Repository': submission.githubRepo,
                        'GitHub Pages URL': submission.githubPagesUrl,
                        Status: 'pending',
                        'Submitted At': new Date().toISOString(),
                        'User ID': submission.userId || '',
                    },
                },
            ],
        }),
    });

    if (!response.ok) {
        const error = await response.text();
        console.error('[Airtable] Create error:', error);
        throw new Error('Failed to create project submission');
    }

    const data = await response.json();
    const record = data.records[0] as AirtableRecord;

    return mapRecordToProject(record);
}

export async function getProjectSubmissions(
    status?: 'pending' | 'approved' | 'rejected'
): Promise<ProjectSubmission[]> {
    let url = airtableUrl;
    
    if (status) {
        const formula = encodeURIComponent(`{Status}='${status}'`);
        url += `?filterByFormula=${formula}&sort[0][field]=Submitted At&sort[0][direction]=desc`;
    } else {
        url += `?sort[0][field]=Submitted At&sort[0][direction]=desc`;
    }

    const response = await fetch(url, {
        headers: {
            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        },
        next: { revalidate: 0 },
    });

    if (!response.ok) {
        const error = await response.text();
        console.error('[Airtable] Fetch error:', error);
        throw new Error('Failed to fetch project submissions');
    }

    const data: AirtableResponse = await response.json();
    return data.records.map(mapRecordToProject);
}

export async function getProjectById(id: string): Promise<ProjectSubmission | null> {
    const response = await fetch(`${airtableUrl}/${id}`, {
        headers: {
            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        },
    });

    if (!response.ok) {
        if (response.status === 404) {
            return null;
        }
        throw new Error('Failed to fetch project');
    }

    const record: AirtableRecord = await response.json();
    return mapRecordToProject(record);
}

export async function updateProjectStatus(
    id: string,
    status: 'approved' | 'rejected',
    reviewedBy: string,
    hoursApproved?: number
): Promise<ProjectSubmission> {
    const fields: Record<string, unknown> = {
        Status: status,
        'Reviewed At': new Date().toISOString(),
        'Reviewed By': reviewedBy,
    };

    if (hoursApproved !== undefined) {
        fields['Hours Approved'] = hoursApproved;
    }

    const response = await fetch(`${airtableUrl}/${id}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields }),
    });

    if (!response.ok) {
        const error = await response.text();
        console.error('[Airtable] Update error:', error);
        throw new Error('Failed to update project status');
    }

    const record: AirtableRecord = await response.json();
    return mapRecordToProject(record);
}

function mapRecordToProject(record: AirtableRecord): ProjectSubmission {
    return {
        id: record.id,
        firstName: record.fields['First Name'] || '',
        lastName: record.fields['Last Name'] || '',
        email: record.fields.Email || '',
        address: record.fields.Address || '',
        school: record.fields.School || '',
        birthDate: record.fields['Birth Date'] || '',
        slackId: record.fields['Slack ID'] || '',
        githubRepo: record.fields['GitHub Repository'] || '',
        githubPagesUrl: record.fields['GitHub Pages URL'] || '',
        hackatimeUrl: record.fields['Hackatime URL'],
        hoursApproved: record.fields['Hours Approved'],
        status: record.fields.Status || 'pending',
        submittedAt: record.fields['Submitted At'] || record.createdTime,
        reviewedAt: record.fields['Reviewed At'],
        reviewedBy: record.fields['Reviewed By'],
        userId: record.fields['User ID'],
    };
}
