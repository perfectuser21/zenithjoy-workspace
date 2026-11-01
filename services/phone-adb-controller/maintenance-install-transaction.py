#!/usr/bin/env python3
"""安全-only 阶段序列；只有同一事务与逐阶段读回才能继续。"""

import re


STEPS = ('close_review_cron', 'relocate_adb', 'disable_recovery',
         'migrate_review', 'seal_candidates')


def run_steps(apply, verify, journal, *, record=lambda _: None):
    if (not isinstance(journal, dict) or
            not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,99}', journal.get('transaction', '')) or
            not re.fullmatch(r'[a-f0-9]{40}', journal.get('source_commit', '')) or
            not isinstance(journal.get('completed'), list) or
            journal['completed'] != list(STEPS[:len(journal['completed'])])):
        raise ValueError('maintenance-only transaction identity invalid')
    for name in journal['completed']:
        if verify(name) is not True:
            raise ValueError('maintenance-only prior proof changed: ' + name)
    for name in STEPS[len(journal['completed']):]:
        apply(name)
        if verify(name) is not True:
            raise ValueError('maintenance-only step not independently verified: ' + name)
        journal['completed'].append(name)
        record(journal)
    return journal
