-- Source e3a01021ee7100b83d8ed5a0be219d0b543b5dff packages/brain/migrations/513_definition_versions.sql sha256=06bf9056a9887d93e58d9e8518208dde96a053529057f0dd3a5d3a743c7fc740
CREATE OR REPLACE FUNCTION immutable_definition_version() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '定义快照不可变：禁止UPDATE/DELETE'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER immutable_activity_version BEFORE UPDATE OR DELETE ON activity_definition_versions FOR EACH ROW EXECUTE FUNCTION immutable_definition_version();
CREATE TRIGGER immutable_workflow_version BEFORE UPDATE OR DELETE ON workflow_definition_versions FOR EACH ROW EXECUTE FUNCTION immutable_definition_version();
-- Source e3a01021ee7100b83d8ed5a0be219d0b543b5dff packages/brain/migrations/515_release_definition_evidence.sql sha256=5eec96db08f3fc5a241a098f406b5dc874773427191204566cbd7e6a534ad7f3
CREATE OR REPLACE FUNCTION immutable_release_evidence() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION '发布与运行证据不可变：禁止UPDATE/DELETE'; END $$ LANGUAGE plpgsql;
CREATE TRIGGER immutable_release_version BEFORE UPDATE OR DELETE ON release_versions FOR EACH ROW EXECUTE FUNCTION immutable_release_evidence();
CREATE TRIGGER immutable_run_definition_binding BEFORE UPDATE OR DELETE ON run_definition_bindings FOR EACH ROW EXECUTE FUNCTION immutable_release_evidence();
