export interface ProjectSubmission {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    address: string;
    school: string;
    birthDate: string;
    slackId: string;
    githubRepo: string;
    githubPagesUrl: string;
    hackatimeUrl?: string;
    hoursApproved?: number;
    status: 'pending' | 'approved' | 'rejected';
    submittedAt: string;
    reviewedAt?: string;
    reviewedBy?: string;
    userId?: string;
}

export interface AirtableRecord {
    id: string;
    fields: {
        'First Name': string;
        'Last Name': string;
        Email: string;
        Address: string;
        School: string;
        'Birth Date': string;
        'Slack ID': string;
        'GitHub Repository': string;
        'GitHub Pages URL': string;
        'Hackatime URL'?: string;
        'Hours Approved'?: number;
        Status: 'pending' | 'approved' | 'rejected';
        'Submitted At': string;
        'Reviewed At'?: string;
        'Reviewed By'?: string;
        'User ID'?: string;
    };
    createdTime: string;
}

export interface AirtableResponse {
    records: AirtableRecord[];
    offset?: string;
}
