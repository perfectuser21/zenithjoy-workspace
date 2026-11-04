import { requireDisposableDatabases } from './disposable-db';
requireDisposableDatabases();
// These contracts exercise local SQL and HTTP callbacks, never external accounts/UI.
for (const name of ['COMPANY_WIKI_EXTERNAL_E2E', 'COMPANY_WIKI_E2E_BROWSER', 'COMPANY_WIKI_EVIDENCE_PATH', 'COMPANY_WIKI_DOCS_PATH']) {
  if (process.env[name]) throw new Error(`${name} is forbidden in the disposable API contract runner`);
}
