import { Session } from 'next-auth';
import { Redis } from '@upstash/redis';
import { AdminRole, AdminPermissions, ROLE_PERMISSIONS } from '../types/Admin';

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

function getGlobalAdmins(): string[] {
    const globalAdmins = process.env.GLOBAL_ADMINS || '';
    const admins = globalAdmins.split(',').map(id => id.trim()).filter(Boolean);
    console.log('[adminAuth] GLOBAL_ADMINS env:', process.env.GLOBAL_ADMINS);
    console.log('[adminAuth] Parsed global admins:', admins);
    return admins;
}

export async function getAdminRole(userId: string): Promise<AdminRole | null> {
    const globalAdmins = getGlobalAdmins();
    console.log('[adminAuth] Checking admin role for user:', userId);
    console.log('[adminAuth] Global admins:', globalAdmins);
    if (globalAdmins.includes(userId)) {
        console.log('[adminAuth] User is a global admin');
        return 'manager';
    }

    try {
        const role = await redis.get<AdminRole>(`admin:${userId}:role`);
        console.log('[adminAuth] Redis role for user:', role);
        return role || null;
    } catch (error) {
        console.error('[adminAuth] Redis error:', error);
        return null;
    }
}

export async function getAdminPermissions(userId: string): Promise<AdminPermissions | null> {
    const role = await getAdminRole(userId);
    if (!role) return null;
    return ROLE_PERMISSIONS[role];
}

export async function isAdmin(session: Session | null): Promise<boolean> {
    if (!session?.user?.id) return false;
    const role = await getAdminRole(session.user.id);
    return role !== null;
}

export async function requireAdminPermission(
    session: Session | null,
    permission: keyof AdminPermissions
): Promise<{ allowed: boolean; role?: AdminRole }> {
    if (!session?.user?.id) {
        return { allowed: false };
    }

    const role = await getAdminRole(session.user.id);
    if (!role) {
        return { allowed: false };
    }

    const permissions = ROLE_PERMISSIONS[role];
    if (!permissions[permission]) {
        return { allowed: false, role };
    }

    return { allowed: true, role };
}

export async function setAdminRole(userId: string, role: AdminRole): Promise<void> {
    await redis.set(`admin:${userId}:role`, role);
}

export async function removeAdmin(userId: string): Promise<void> {
    await redis.del(`admin:${userId}:role`);
}

export async function listAdmins(): Promise<Array<{ userId: string; role: AdminRole }>> {
    try {
        const keys = await redis.keys('admin:*:role');
        const admins: Array<{ userId: string; role: AdminRole }> = [];

        for (const key of keys) {
            const userId = key.split(':')[1];
            const role = await redis.get<AdminRole>(key);
            if (role) {
                admins.push({ userId, role });
            }
        }

        return admins;
    } catch {
        return [];
    }
}
