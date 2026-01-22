'use client';

import { useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import Icon from 'supercons';

export default function SubmitProjectPage() {
    const { data: session, status } = useSession();
    const [formData, setFormData] = useState({
        firstName: '',
        lastName: '',
        email: '',
        address: '',
        school: '',
        birthDate: '',
        slackId: '',
        githubRepo: '',
        githubPagesUrl: '',
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData(prev => ({
            ...prev,
            [e.target.name]: e.target.value,
        }));
        setError(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);

        try {
            const response = await fetch('/api/projects/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to submit project');
            }

            setSuccess(true);
            setFormData({
                firstName: '',
                lastName: '',
                email: '',
                address: '',
                school: '',
                birthDate: '',
                slackId: '',
                githubRepo: '',
                githubPagesUrl: '',
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (status === 'loading') {
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
                <div className="text-hackclub-dark font-bold">Loading...</div>
            </div>
        );
    }

    if (!session) {
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
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white rounded-2xl shadow-xl border-2 border-gray-200 p-8 max-w-md w-full mx-4 text-center"
                >
                    <div className="w-16 h-16 bg-hackclub-red/10 rounded-full flex items-center justify-center mx-auto mb-4">
                        <Icon glyph="member-add" size={32} style={{ color: 'var(--hackclub-red, #EC3750)' }} />
                    </div>
                    <h2 className="text-2xl font-black text-hackclub-dark mb-2">Sign In Required</h2>
                    <p className="text-hackclub-slate mb-6">
                        You need to sign in with your Hack Club account to submit a project.
                    </p>
                    <button
                        onClick={() => signIn('hackclub', { callbackUrl: '/submit' })}
                        className="w-full bg-hackclub-red hover:bg-hackclub-orange text-white font-black py-3 px-6 rounded-full transition-colors"
                    >
                        Sign In with Hack Club
                    </button>
                </motion.div>
            </div>
        );
    }

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
            <div className="max-w-3xl mx-auto px-4 py-12">
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                >
                    <div className="text-center mb-12">
                        <h1 className="text-5xl sm:text-6xl font-black text-hackclub-dark mb-4">
                            Submit Your <span className="text-hackclub-red">Project</span>
                        </h1>
                        <p className="text-lg text-hackclub-slate max-w-xl mx-auto">
                            Share what you&apos;ve built and earn <span className="font-black text-hackclub-green">$5 per approved hour</span> in shop credits!
                        </p>
                    </div>

                    <AnimatePresence mode="wait">
                        {success ? (
                            <motion.div
                                key="success"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                className="bg-white rounded-2xl shadow-xl border-2 border-hackclub-green p-8 text-center"
                            >
                                <div className="w-20 h-20 bg-hackclub-green/10 rounded-full flex items-center justify-center mx-auto mb-6">
                                    <Icon glyph="checkmark" size={40} style={{ color: 'var(--hackclub-green, #33d6a6)' }} />
                                </div>
                                <h2 className="text-3xl font-black text-hackclub-dark mb-3">
                                    Project Submitted!
                                </h2>
                                <p className="text-hackclub-slate mb-8 max-w-md mx-auto">
                                    Your project is now pending review. Once your hours are approved, you&apos;ll receive $5 per hour in shop credits!
                                </p>
                                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                                    <button
                                        onClick={() => setSuccess(false)}
                                        className="bg-hackclub-red hover:bg-hackclub-orange text-white font-black py-3 px-8 rounded-full transition-colors"
                                    >
                                        Submit Another
                                    </button>
                                    <Link
                                        href="/shop"
                                        className="bg-hackclub-dark hover:bg-hackclub-slate text-white font-black py-3 px-8 rounded-full transition-colors"
                                    >
                                        Browse Shop
                                    </Link>
                                </div>
                            </motion.div>
                        ) : (
                            <motion.form
                                key="form"
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                exit={{ opacity: 0, scale: 0.95 }}
                                onSubmit={handleSubmit}
                                className="bg-white rounded-2xl shadow-xl border-2 border-gray-200 p-8"
                            >
                                <div className="space-y-6">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label htmlFor="firstName" className="block text-sm font-black text-hackclub-dark mb-2">
                                                First Name
                                            </label>
                                            <input
                                                type="text"
                                                id="firstName"
                                                name="firstName"
                                                value={formData.firstName}
                                                onChange={handleChange}
                                                required
                                                placeholder="John"
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-hackclub-red focus:outline-none transition-colors font-medium"
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor="lastName" className="block text-sm font-black text-hackclub-dark mb-2">
                                                Last Name
                                            </label>
                                            <input
                                                type="text"
                                                id="lastName"
                                                name="lastName"
                                                value={formData.lastName}
                                                onChange={handleChange}
                                                required
                                                placeholder="Doe"
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-hackclub-red focus:outline-none transition-colors font-medium"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label htmlFor="email" className="block text-sm font-black text-hackclub-dark mb-2">
                                            <span className="flex items-center gap-2">
                                                <Icon glyph="email" size={18} />
                                                Email Address
                                            </span>
                                        </label>
                                        <input
                                            type="email"
                                            id="email"
                                            name="email"
                                            value={formData.email}
                                            onChange={handleChange}
                                            required
                                            placeholder="you@example.com"
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-hackclub-red focus:outline-none transition-colors font-medium"
                                        />
                                    </div>

                                    <div>
                                        <label htmlFor="address" className="block text-sm font-black text-hackclub-dark mb-2">
                                            <span className="flex items-center gap-2">
                                                <Icon glyph="home" size={18} />
                                                Address
                                            </span>
                                        </label>
                                        <input
                                            type="text"
                                            id="address"
                                            name="address"
                                            value={formData.address}
                                            onChange={handleChange}
                                            required
                                            placeholder="123 Main St, City, State, ZIP"
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-hackclub-red focus:outline-none transition-colors font-medium"
                                        />
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div>
                                            <label htmlFor="school" className="block text-sm font-black text-hackclub-dark mb-2">
                                                <span className="flex items-center gap-2">
                                                    <Icon glyph="explore" size={18} />
                                                    School
                                                </span>
                                            </label>
                                            <input
                                                type="text"
                                                id="school"
                                                name="school"
                                                value={formData.school}
                                                onChange={handleChange}
                                                required
                                                placeholder="Your School Name"
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-hackclub-red focus:outline-none transition-colors font-medium"
                                            />
                                        </div>
                                        <div>
                                            <label htmlFor="birthDate" className="block text-sm font-black text-hackclub-dark mb-2">
                                                <span className="flex items-center gap-2">
                                                    <Icon glyph="event-add" size={18} />
                                                    Birth Date
                                                </span>
                                            </label>
                                            <input
                                                type="date"
                                                id="birthDate"
                                                name="birthDate"
                                                value={formData.birthDate}
                                                onChange={handleChange}
                                                required
                                                className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-hackclub-red focus:outline-none transition-colors font-medium"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label htmlFor="slackId" className="block text-sm font-black text-hackclub-dark mb-2">
                                            <span className="flex items-center gap-2">
                                                <Icon glyph="slack" size={18} />
                                                Hack Club Slack ID
                                            </span>
                                        </label>
                                        <input
                                            type="text"
                                            id="slackId"
                                            name="slackId"
                                            value={formData.slackId}
                                            onChange={handleChange}
                                            required
                                            placeholder="U0123456789"
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-hackclub-red focus:outline-none transition-colors font-medium"
                                        />
                                        <p className="text-sm text-hackclub-muted mt-1">
                                            Find your Slack ID by clicking your profile in the Hack Club Slack
                                        </p>
                                    </div>

                                    <div>
                                        <label htmlFor="githubRepo" className="block text-sm font-black text-hackclub-dark mb-2">
                                            <span className="flex items-center gap-2">
                                                <Icon glyph="github" size={18} />
                                                GitHub Repository
                                            </span>
                                        </label>
                                        <input
                                            type="url"
                                            id="githubRepo"
                                            name="githubRepo"
                                            value={formData.githubRepo}
                                            onChange={handleChange}
                                            required
                                            placeholder="https://github.com/user/repo"
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-hackclub-red focus:outline-none transition-colors font-medium"
                                        />
                                    </div>

                                    <div>
                                        <label htmlFor="githubPagesUrl" className="block text-sm font-black text-hackclub-dark mb-2">
                                            <span className="flex items-center gap-2">
                                                <Icon glyph="link" size={18} />
                                                GitHub Pages URL
                                            </span>
                                        </label>
                                        <input
                                            type="url"
                                            id="githubPagesUrl"
                                            name="githubPagesUrl"
                                            value={formData.githubPagesUrl}
                                            onChange={handleChange}
                                            required
                                            placeholder="https://user.github.io/repo"
                                            className="w-full px-4 py-3 rounded-xl border-2 border-gray-200 focus:border-hackclub-red focus:outline-none transition-colors font-medium"
                                        />
                                    </div>
                                </div>

                                {error && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="mt-6 bg-red-50 border-2 border-hackclub-red/20 rounded-xl p-4"
                                    >
                                        <p className="text-hackclub-red font-bold text-sm flex items-center gap-2">
                                            <Icon glyph="important" size={18} />
                                            {error}
                                        </p>
                                    </motion.div>
                                )}

                                <div className="mt-8 bg-hackclub-smoke rounded-xl p-4 border-2 border-gray-100">
                                    <div className="flex items-start gap-3">
                                        <div className="w-10 h-10 bg-hackclub-green/10 rounded-lg flex items-center justify-center flex-shrink-0">
                                            <Icon glyph="bolt-circle" size={20} style={{ color: 'var(--hackclub-green, #33d6a6)' }} />
                                        </div>
                                        <div>
                                            <p className="font-black text-hackclub-dark">Earn $5 per approved hour</p>
                                            <p className="text-sm text-hackclub-slate">
                                                Once your project hours are reviewed and approved, you&apos;ll automatically receive $5 per hour in shop credits!
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className={`w-full mt-8 bg-hackclub-red hover:bg-hackclub-orange text-white font-black py-4 px-8 rounded-full transition-all text-lg ${
                                        isSubmitting ? 'opacity-50 cursor-not-allowed' : 'hover:scale-[1.02] hover:shadow-lg'
                                    }`}
                                >
                                    {isSubmitting ? (
                                        <span className="flex items-center justify-center gap-2">
                                            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                            </svg>
                                            Submitting...
                                        </span>
                                    ) : (
                                        'Submit Project'
                                    )}
                                </button>
                            </motion.form>
                        )}
                    </AnimatePresence>
                </motion.div>
            </div>
        </div>
    );
}
