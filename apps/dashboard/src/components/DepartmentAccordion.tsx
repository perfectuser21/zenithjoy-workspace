import { useState } from 'react';
import { ChevronDown, ChevronRight, Building2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DynamicIcon } from './DynamicIcon';
import type { DepartmentWithStats } from '../api/ai-employees.api';

interface DepartmentAccordionProps {
  department: DepartmentWithStats;
  defaultExpanded?: boolean;
}

export function DepartmentAccordion({ department, defaultExpanded = false }: DepartmentAccordionProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const navigate = useNavigate();
  const employeeCount = department.employees.length;
  const hasEmployees = employeeCount > 0;

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
      {/* 部门头部 - 可点击展开/收起 */}
      <button
        onClick={() => hasEmployees && setIsExpanded(!isExpanded)}
        disabled={!hasEmployees}
        className={`w-full flex items-center justify-between p-4 text-left transition-colors ${
          hasEmployees ? 'hover:bg-slate-50 dark:hover:bg-slate-700/50 cursor-pointer' : 'cursor-default opacity-60'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
            <DynamicIcon name={department.icon} className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-800 dark:text-white flex items-center gap-2">
              {department.name}
              <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
                ({employeeCount}人)
              </span>
            </h3>
            {department.description && (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {department.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {department.todayTotal > 0 && (
            <span className="text-sm text-blue-600 dark:text-blue-400">
              今日 {department.todayTotal} 次任务
            </span>
          )}
          {hasEmployees && (
            isExpanded ? (
              <ChevronDown className="w-5 h-5 text-slate-400" />
            ) : (
              <ChevronRight className="w-5 h-5 text-slate-400" />
            )
          )}
        </div>
      </button>

      {/* 员工列表 - 展开时显示 */}
      {isExpanded && hasEmployees && (
        <div className="border-t border-slate-100 dark:border-slate-700">
          {department.employees.map((employee, index) => (
            <button
              key={employee.id}
              onClick={() => navigate(`/ai-employees/${employee.id}`)}
              className={`w-full flex items-center justify-between p-4 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors ${
                index > 0 ? 'border-t border-slate-100 dark:border-slate-700' : ''
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                  <DynamicIcon name={employee.icon} className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                </div>
                <div>
                  <h4 className="font-medium text-slate-800 dark:text-white">
                    {employee.name}
                  </h4>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    {employee.role}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {employee.stats.todayRunning > 0 ? (
                  <span className="text-xs px-2 py-1 bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded-full">
                    工作中
                  </span>
                ) : employee.stats.todayTotal > 0 ? (
                  <span className="text-xs px-2 py-1 bg-green-100 dark:bg-green-900/50 text-green-700 dark:text-green-300 rounded-full">
                    今日 {employee.stats.todayTotal} 次
                  </span>
                ) : (
                  <span className="text-xs px-2 py-1 bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-full">
                    空闲
                  </span>
                )}
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 空部门提示 */}
      {!hasEmployees && (
        <div className="border-t border-slate-100 dark:border-slate-700 p-6 text-center">
          <Building2 className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-400 dark:text-slate-500">部门待招聘</p>
        </div>
      )}
    </div>
  );
}
