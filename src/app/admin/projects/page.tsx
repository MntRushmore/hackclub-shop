'use client';

import { useState, useEffect, useCallback } from 'react';
import Icon from 'supercons';
import { ProjectSubmission } from '../../../types/Project';
import { PageHeader, Card, ErrorBanner, EmptyState, LoadingScreen } from '../ui';

type FilterStatus = 'all' | 'pending' | 'approved' | 'rejected';

export default function AdminProjectsPage() {
    const [projects, setProjects] = useState<ProjectSubmission[]>([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState<FilterStatus>('pending');
    const [processingId, setProcessingId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [hoursInput, setHoursInput] = useState<{ [key: string]: string }>({});
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const fetchProjects = useCallback(async (currentFilter: FilterStatus) => {
        try {
            const statusParam = currentFilter === 'all' ? '' : `?status=${currentFilter}`;
            const res = await fetch(`/api/admin/projects${statusParam}`);
            if (res.ok) {
                const data = await res.json();
                setProjects(data.projects);
            }
        } catch (err) {
            console.error('Failed to fetch projects:', err);
        }
    }, []);

    useEffect(() => {
        (async () => {
            await fetchProjects(filter);
            setLoading(false);
        })();
    }, [filter, fetchProjects]);

    const handleApprove = async (projectId: string, projectName: string) => {
        const hours = parseFloat(hoursInput[projectId] || '0');
        if (hours <= 0) {
            setError('Please enter a valid number of hours to approve');
            return;
        }

        setProcessingId(projectId);
        setError(null);

        try {
            const res = await fetch(`/api/admin/projects/${projectId}/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hoursApproved: hours }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Failed to approve project');
            }

            setSuccessMessage(`Approved "${projectName}" - ${hours} hours = ${data.pointsAwarded} pts awarded!`);
            setTimeout(() => setSuccessMessage(null), 5000);
            setHoursInput(prev => {
                const newState = { ...prev };
                delete newState[projectId];
                return newState;
            });
            await fetchProjects(filter);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to approve');
        } finally {
            setProcessingId(null);
        }
    };

    const handleReject = async (projectId: string, projectName: string) => {
        setProcessingId(projectId);
        setError(null);

        try {
            const res = await fetch(`/api/admin/projects/${projectId}/reject`, {
                method: 'POST',
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Failed to reject project');
            }

            setSuccessMessage(`Rejected "${projectName}"`);
            setTimeout(() => setSuccessMessage(null), 5000);
            await fetchProjects(filter);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to reject');
        } finally {
            setProcessingId(null);
        }
    };

    const pendingCount = projects.filter(p => p.status === 'pending').length;

    const filterButtons = (
        <div className="flex gap-2 overflow-x-auto">
            {(['pending', 'approved', 'rejected', 'all'] as FilterStatus[]).map((s) => (
                <button
                    key={s}
                    onClick={() => setFilter(s)}
                    className={`px-4 py-1.5 rounded-full text-sm font-bold transition-colors whitespace-nowrap ${
                        filter === s
                            ? 'bg-hackclub-red text-white'
                            : 'bg-white text-hackclub-slate border border-gray-200 hover:border-hackclub-red'
                    }`}
                >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                    {s === 'pending' && pendingCount > 0 && (
                        <span className="ml-2 bg-white/20 px-2 py-0.5 rounded-full text-xs">
                            {pendingCount}
                        </span>
                    )}
                </button>
            ))}
        </div>
    );

    if (loading) {
        return (
            <>
                <PageHeader title="Project Submissions" subtitle="5 points per approved hour" />
                <LoadingScreen />
            </>
        );
    }

    return (
        <>
            <PageHeader
                title="Project Submissions"
                subtitle="5 points per approved hour"
                actions={filterButtons}
            />

            {pendingCount > 0 && filter !== 'pending' && (
                <p className="text-hackclub-orange font-bold mb-4">
                    {pendingCount} pending review
                </p>
            )}

            {successMessage && (
                <div className="mb-4 rounded-lg border border-hackclub-green/30 bg-hackclub-green/5 px-4 py-3">
                    <p className="text-sm font-bold text-hackclub-green flex items-center gap-2">
                        <Icon glyph="checkmark" size={20} />
                        {successMessage}
                    </p>
                </div>
            )}

            {error && <ErrorBanner message={error} />}

            {projects.length === 0 ? (
                <EmptyState
                    message={
                        filter === 'all'
                            ? 'No projects have been submitted yet.'
                            : `No ${filter} projects found.`
                    }
                />
            ) : (
                <div className="space-y-4">
                    {projects.map((project) => (
                        <Card key={project.id}>
                            <div className="flex flex-col gap-4">
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 flex-wrap">
                                            <h3 className="text-lg font-black text-hackclub-dark">
                                                {project.firstName} {project.lastName}
                                            </h3>
                                            <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                                                project.status === 'pending'
                                                    ? 'bg-hackclub-orange/10 text-hackclub-orange'
                                                    : project.status === 'approved'
                                                    ? 'bg-hackclub-green/10 text-hackclub-green'
                                                    : 'bg-gray-100 text-hackclub-slate'
                                            }`}>
                                                {project.status.charAt(0).toUpperCase() + project.status.slice(1)}
                                                {project.status === 'approved' && project.hoursApproved && (
                                                    <span className="ml-1">• {project.hoursApproved}h = ${project.hoursApproved * 5}</span>
                                                )}
                                            </span>
                                        </div>
                                        <p className="text-hackclub-slate font-medium mt-1">
                                            {project.email}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => setExpandedId(expandedId === project.id ? null : project.id)}
                                        className="p-2 rounded-lg hover:bg-hackclub-smoke transition-colors"
                                    >
                                        <Icon
                                            glyph={expandedId === project.id ? 'up-caret' : 'down-caret'}
                                            size={20}
                                        />
                                    </button>
                                </div>

                                {expandedId === project.id && (
                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-4 border-t border-gray-100">
                                        <div className="bg-hackclub-smoke rounded-lg p-3">
                                            <p className="text-xs text-hackclub-muted font-bold uppercase mb-1">School</p>
                                            <p className="text-hackclub-dark font-medium">{project.school}</p>
                                        </div>
                                        <div className="bg-hackclub-smoke rounded-lg p-3">
                                            <p className="text-xs text-hackclub-muted font-bold uppercase mb-1">Birth Date</p>
                                            <p className="text-hackclub-dark font-medium">
                                                {new Date(project.birthDate).toLocaleDateString()}
                                            </p>
                                        </div>
                                        <div className="bg-hackclub-smoke rounded-lg p-3">
                                            <p className="text-xs text-hackclub-muted font-bold uppercase mb-1">Slack ID</p>
                                            <p className="text-hackclub-dark font-medium font-mono">{project.slackId}</p>
                                        </div>
                                        <div className="bg-hackclub-smoke rounded-lg p-3 sm:col-span-2 lg:col-span-3">
                                            <p className="text-xs text-hackclub-muted font-bold uppercase mb-1">Address</p>
                                            <p className="text-hackclub-dark font-medium">{project.address}</p>
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <a
                                        href={project.githubRepo}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 px-4 py-2 bg-hackclub-smoke rounded-lg text-hackclub-slate hover:text-hackclub-dark hover:bg-gray-100 transition-colors font-medium text-sm"
                                    >
                                        <Icon glyph="github" size={16} />
                                        <span className="truncate">GitHub Repo</span>
                                        <Icon glyph="external" size={14} className="ml-auto flex-shrink-0" />
                                    </a>
                                    <a
                                        href={project.githubPagesUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-2 px-4 py-2 bg-hackclub-smoke rounded-lg text-hackclub-slate hover:text-hackclub-blue hover:bg-hackclub-blue/5 transition-colors font-medium text-sm"
                                    >
                                        <Icon glyph="link" size={16} />
                                        <span className="truncate">Live Site</span>
                                        <Icon glyph="external" size={14} className="ml-auto flex-shrink-0" />
                                    </a>
                                    {project.hackatimeUrl && (
                                        <a
                                            href={project.hackatimeUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-2 px-4 py-2 bg-hackclub-orange/10 rounded-lg text-hackclub-orange hover:bg-hackclub-orange/20 transition-colors font-medium text-sm"
                                        >
                                            <Icon glyph="clock" size={16} />
                                            <span className="truncate">Hackatime</span>
                                            <Icon glyph="external" size={14} className="ml-auto flex-shrink-0" />
                                        </a>
                                    )}
                                </div>

                                <div className="flex items-center justify-between text-sm text-hackclub-muted pt-2 border-t border-gray-100">
                                    <span>
                                        Submitted {new Date(project.submittedAt).toLocaleDateString('en-US', {
                                            year: 'numeric',
                                            month: 'short',
                                            day: 'numeric',
                                            hour: '2-digit',
                                            minute: '2-digit',
                                        })}
                                    </span>
                                    {project.reviewedAt && (
                                        <span>
                                            Reviewed {new Date(project.reviewedAt).toLocaleDateString('en-US', {
                                                year: 'numeric',
                                                month: 'short',
                                                day: 'numeric',
                                            })}
                                        </span>
                                    )}
                                </div>

                                {project.status === 'pending' && (
                                    <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-gray-100">
                                        <div className="flex-1 flex items-center gap-2">
                                            <label htmlFor={`hours-${project.id}`} className="text-sm font-bold text-hackclub-dark whitespace-nowrap">
                                                Hours to approve:
                                            </label>
                                            <input
                                                type="number"
                                                id={`hours-${project.id}`}
                                                min="0.5"
                                                step="0.5"
                                                value={hoursInput[project.id] || ''}
                                                onChange={(e) => setHoursInput(prev => ({ ...prev, [project.id]: e.target.value }))}
                                                placeholder="0"
                                                className="w-24 px-3 py-2 rounded-lg border border-gray-200 focus:border-hackclub-green focus:outline-none transition-colors font-bold text-center"
                                            />
                                            {hoursInput[project.id] && parseFloat(hoursInput[project.id]) > 0 && (
                                                <span className="text-hackclub-green font-bold">
                                                    = ${(parseFloat(hoursInput[project.id]) * 5).toFixed(2)}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => handleApprove(project.id, `${project.firstName} ${project.lastName}`)}
                                                disabled={processingId === project.id || !hoursInput[project.id] || parseFloat(hoursInput[project.id]) <= 0}
                                                className={`flex items-center justify-center gap-2 px-6 py-2 rounded-xl font-bold transition-colors ${
                                                    processingId === project.id || !hoursInput[project.id] || parseFloat(hoursInput[project.id]) <= 0
                                                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                        : 'bg-hackclub-green text-white hover:bg-hackclub-green/90'
                                                }`}
                                            >
                                                {processingId === project.id ? (
                                                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                                    </svg>
                                                ) : (
                                                    <>
                                                        <Icon glyph="checkmark" size={18} />
                                                        Approve
                                                    </>
                                                )}
                                            </button>
                                            <button
                                                onClick={() => handleReject(project.id, `${project.firstName} ${project.lastName}`)}
                                                disabled={processingId === project.id}
                                                className={`flex items-center justify-center gap-2 px-6 py-2 rounded-xl font-bold transition-colors ${
                                                    processingId === project.id
                                                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                        : 'bg-white border border-hackclub-red text-hackclub-red hover:bg-hackclub-red hover:text-white'
                                                }`}
                                            >
                                                <Icon glyph="view-close" size={18} />
                                                Reject
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </Card>
                    ))}
                </div>
            )}
        </>
    );
}
