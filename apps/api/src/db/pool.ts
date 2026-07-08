/**
 * Named export wrapper for the pg Pool instance.
 * Allows vi.mock('../../../apps/api/src/db/pool', () => ({ pool: mockPool })) in tests.
 */
import connection from './connection';

export const pool = connection;
