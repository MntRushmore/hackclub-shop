'use client';

import CommandCenter from './CommandCenter';
import { PageHeader } from './ui';

/**
 * Admin home is just the ops feed: what needs a human right now. Navigation to
 * every tool lives in the layout sidebar, so there is no card grid here.
 */
export default function AdminDashboard() {
    return (
        <>
            <PageHeader title="Overview" subtitle="What needs attention right now" />
            <CommandCenter />
        </>
    );
}
