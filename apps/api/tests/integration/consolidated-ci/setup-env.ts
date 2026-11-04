import { disposableConnection } from './connection';
disposableConnection();
process.env.NODE_ENV = 'test';
process.env.ZENITHJOY_INTERNAL_TOKEN = 'isolated-contract-token';
process.env.ADMIN_FEISHU_OPENIDS = 'isolated-admin';
process.env.BETTER_AUTH_SECRET = 'isolated-contract-auth-secret-32-characters';
