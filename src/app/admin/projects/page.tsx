'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import Icon from 'supercons';
import { ProjectSubmission } from '../../../types/Project';

type FilterStatus = 'all' | 'pending' | 'approved' | 'rejected';

export default function AdminProjectsPage() {
    const { data: session, status } = useSession();
    const [projects, setProjects] = useState<ProjectSubmission[]>([]);
    const [loading, setLoading] = useState(true);
    const [isAdmin, setIsAdmin] = useState(false);
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
        if (status === 'unauthenticated') {
            signIn('hackclub', { callbackUrl: '/admin/projects' });
        }
    }, [status]);

    useEffect(() => {
        const checkAdminAndFetch = async () => {
            if (!session?.user?.id) {
                setLoading(false);
                return;
            }

            try {
                const adminRes = await fetch('/api/admin/stats');
                if (adminRes.ok) {
                    setIsAdmin(true);
                    await fetchProjects(filter);
                } else {
                    setIsAdmin(false);
                }
            } catch {
                setIsAdmin(false);
            } finally {
                setLoading(false);
            }
        };

        if (session) {
            checkAdminAndFetch();
        }
    }, [session, filter, fetchProjects]);

    useEffect(() => {
        if (isAdmin) {
            fetchProjects(filter);
        }
    }, [filter, isAdmin, fetchProjects]);

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

            setSuccessMessage(`Approved "${projectName}" - ${hours} hours = $${data.creditsAwarded} awarded!`);
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

    if (status === 'loading' || loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-hackclub-smoke">
                <div className="text-hackclub-dark font-bold">Loading...</div>
            </div>
        );
    }

    if (!session) {
        return null;
    }

    if (!isAdmin) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-white"
                style={{
                    backgroundImage: `
                        linear-gradient(to right, #e0f2fe 1px, transparent 1px),
                        linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)
                    `,
                    backgroundSize: '30px 30px',
                }}
            >
                <div className="bg-white rounded-2xl shadow-xl border-2 border-gray-200 p-8 max-w-md w-full mx-4 text-center">
                    <div className="w-16 h-16 bg-hackclub-red/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Icon glyph="private" size={32} style={{ color: 'var(--hackclub-red, #EC3750)' }} />
                    </div>
                    <h2 className="text-2xl font-black text-hackclub-dark mb-2">Access Denied</h2>
                    <p className="text-hackclub-slate mb-6">
                        You don&apos;t have permission to access this page.
                    </p>
                    <Link
                        href="/"
                        className="inline-block w-full bg-hackclub-red hover:bg-hackclub-orange text-white font-black py-3 px-6 rounded-full transition-colors"
                    >
                        Back to Shop
                    </Link>
                </div>
            </div>
        );
    }

    const pendingCount = projects.filter(p => p.status === 'pending').length;

    return (
        <div className="min-h-screen bg-white"
            style={{
                backgroundImage: `
                    linear-gradient(to right, #e0f2fe 1px, transparent 1px),
                    linear-gradient(to bottom, #e0f2fe 1px, transparent 1px)
                `,
                backgroundSize: '30px 30px',
            }}
        >
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                >
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
                        <div>
                            <Link
                                href="/admin"
                                className="inline-flex items-center gap-2 text-hackclub-slate hover:text-hackclub-red font-bold mb-4 transition-colors"
                            >
                                <Icon glyph="view-back" size={20} />
                                Back to Admin
                            </Link>
                            <h1 className="text-4xl sm:text-5xl font-black text-hackclub-dark">
                                Project Submissions
                            </h1>
                            <p className="text-hackclub-muted mt-2">
                                $5 per approved hour
                            </p>
                            {pendingCount > 0 && filter !== 'pending' && (
                                <p className="text-hackclub-orange font-bold mt-1">
                                    {pendingCount} pending review
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="flex gap-2 mb-8 overflow-x-auto pb-2">
                        {(['pending', 'approved', 'rejected', 'all'] as FilterStatus[]).map((s) => (
                            <button
                                key={s}
                                onClick={() => setFilter(s)}
                                className={`px-6 py-2 rounded-full font-bold transition-all whitespace-nowrap ${
                                    filter === s
                                        ? 'bg-hackclub-red text-white shadow-lg'
                                        : 'bg-white text-hackclub-slate border-2 border-gray-200 hover:border-hackclub-red'
                                }`}
                            >
                                {s.charAt(0).toUpperCase() + s.slice(1)}
                                {s === 'pending' && pendingCount > 0 && (
                                    <span className="ml-2 bg-white/20 px-2 py-0.5 rounded-full text-sm">
                                        {pendingCount}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>

                    <AnimatePresence>
                        {successMessage && (
                            <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="mb-6 bg-hackclub-green/10 border-2 border-hackclub-green rounded-xl p-4"
                            >
                                <p className="text-hackclub-green font-bold flex items-center gap-2">
                                    <Icon glyph="checkmark" size={20} />
                                    {successMessage}
                                </p>
                            </motion.div>
                        )}

                        {error && (
                            <motion.div
                                initial={{ opacity: 0, y: -10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                className="mb-6 bg-red-50 border-2 border-hackclub-red/20 rounded-xl p-4"
                            >
                                <p className="text-hackclub-red font-bold flex items-center gap-2">
                                    <Icon glyph="important" size={20} />
                                    {error}
                                </p>
                            </motion.div>
                        )}
                    </AnimatePresence>

                    {projects.length === 0 ? (
                        <div className="bg-white rounded-2xl shadow-lg border-2 border-gray-200 p-12 text-center">
                            <div className="w-16 h-16 bg-hackclub-muted/10 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Icon glyph="docs" size={32} style={{ color: 'var(--hackclub-muted, #8492a6)' }} />
                            </div>
                            <h3 className="text-xl font-black text-hackclub-dark mb-2">No Projects Found</h3>
                            <p className="text-hackclub-slate">
                                {filter === 'all' 
                                    ? "No projects have been submitted yet."
                                    : `No ${filter} projects found.`}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {projects.map((project, index) => (
                                <motion.div
                                    key={project.id}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: index * 0.05 }}
                                    className={`bg-white rounded-2xl shadow-lg border-2 p-6 transition-all ${
                                        project.status === 'pending' 
                                            ? 'border-hackclub-orange/30' 
                                            : project.status === 'approved'
                                            ? 'border-hackclub-green/30'
                                            : 'border-gray-200'
                                    }`}
                                >
                                    <div className="flex flex-col gap-4">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-3 flex-wrap">
                                                    <h3 className="text-xl font-black text-hackclub-dark">
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

                                        <AnimatePresence>
                                            {expandedId === project.id && (
                                                <motion.div
                                                    initial={{ opacity: 0, height: 0 }}
                                                    animate={{ opacity: 1, height: 'auto' }}
                                                    exit={{ opacity: 0, height: 0 }}
                                                    className="overflow-hidden"
                                                >
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
                                                </motion.div>
                                            )}
                                        </AnimatePresence>

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
                                                        className="w-24 px-3 py-2 rounded-lg border-2 border-gray-200 focus:border-hackclub-green focus:outline-none transition-colors font-bold text-center"
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
                                                        className={`flex items-center justify-center gap-2 px-6 py-2 rounded-xl font-bold transition-all ${
                                                            processingId === project.id || !hoursInput[project.id] || parseFloat(hoursInput[project.id]) <= 0
                                                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                                : 'bg-hackclub-green text-white hover:bg-hackclub-green/90 hover:shadow-lg'
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
                                                        className={`flex items-center justify-center gap-2 px-6 py-2 rounded-xl font-bold transition-all ${
                                                            processingId === project.id
                                                                ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                                                : 'bg-white border-2 border-hackclub-red text-hackclub-red hover:bg-hackclub-red hover:text-white'
                                                        }`}
                                                    >
                                                        <Icon glyph="view-close" size={18} />
                                                        Reject
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            ))}
                        </div>
                    )}
                </motion.div>
            </div>
        </div>
    );
}
