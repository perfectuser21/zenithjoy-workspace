#!/usr/bin/env python3
"""Require actual nonempty, unskipped JVM suites from the real Android production test task."""
import pathlib,sys,xml.etree.ElementTree as ET
root=pathlib.Path(sys.argv[1]); required=['com.zenithjoy.agent.AgentServiceCommandRouteTest','com.zenithjoy.agent.ContentJudgmentClientWiringTest','com.zenithjoy.agent.command.CommandProtocolTest','com.zenithjoy.agent.command.CommandExecutorTest','com.zenithjoy.agent.command.CommandQueueTest','com.zenithjoy.agent.command.CommandLeaseEntryGuardTest','com.zenithjoy.agent.command.CommandWiringSourceTest']
total=0
for name in required:
 path=root/f'TEST-{name}.xml'
 if not path.is_file():raise SystemExit(f'FAIL: missing Android suite {name}')
 suite=ET.parse(path).getroot(); cases=list(suite.iter('testcase'))
 if not cases or any(suite.get(key,'0')!='0' for key in ['failures','errors','skipped']) or any(case.find(tag)is not None for case in cases for tag in ['failure','error','skipped']):raise SystemExit(f'FAIL: empty, failed or skipped Android suite {name}')
 total+=len(cases)
print(f'Android actual required suites={len(required)} executed_tests={total} skipped=0')
