'use strict';

const shanghaiTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Use the same business-line mapping as the frozen company configuration. */
async function readOutreachSettings(pool, lineKey, { companyId = null, tenantId = null } = {}) {
  const { rows } = await pool.query(`
    SELECT p.company_id, p.tenant_id, s.daily_cap, s.paused, s.revision,
           to_char(s.start_local, 'HH24:MI') AS start_local, to_char(s.end_local, 'HH24:MI') AS end_local
    FROM zenithjoy.tenant_company_profiles p
    LEFT JOIN zenithjoy.company_outreach_settings s ON s.tenant_id=p.tenant_id AND s.company_id=p.company_id
    WHERE p.runtime_config->'routing'->>'line_key'=$1
      AND ($2::uuid IS NULL OR p.company_id=$2)
      AND ($3::uuid IS NULL OR p.tenant_id=$3)
  `, [lineKey, companyId, tenantId]);
  if (rows.length !== 1) throw Error('OUTREACH_SETTINGS_COMPANY_MAPPING_INVALID');
  return rows[0].daily_cap == null ? null : rows[0];
}

function assertOutreachWindow(settings, now = new Date()) {
  if (!settings) return;
  if (settings.paused) throw Error('OUTREACH_PAUSED');
  const { start_local: start, end_local: end } = settings;
  const local = shanghaiTime.format(now);
  const within = start === end || (start < end ? local >= start && local < end : local >= start || local < end);
  if (!within) throw Error('OUTREACH_WINDOW_CLOSED');
}

module.exports = { readOutreachSettings, assertOutreachWindow };
