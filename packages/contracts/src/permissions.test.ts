import {describe, expect, it} from 'vitest';
import {can, permissionsFor} from './permissions.js';

describe('role capability matrix', () => {
    it('keeps viewers read-only on findings', () => {
        expect(can('viewer', 'exception:read')).toBe(true);
        expect(can('viewer', 'exception:transition')).toBe(false);
    });

    it('lets members work the queue but not change rules or membership', () => {
        expect(can('member', 'exception:transition')).toBe(true);
        expect(can('member', 'run:trigger')).toBe(true);
        expect(can('member', 'rule:write')).toBe(false);
        expect(can('member', 'member:write')).toBe(false);
    });

    it('reserves the audit log for admins and viewers, matching the PRD matrix', () => {
        expect(can('viewer', 'audit:read')).toBe(true);
        expect(can('member', 'audit:read')).toBe(false);
        expect(can('admin', 'audit:read')).toBe(true);
    });

    it('grants admins every capability', () => {
        expect(permissionsFor('admin')).toContain('ops:dlq');
        expect(permissionsFor('admin').length).toBeGreaterThan(permissionsFor('member').length);
    });
});
