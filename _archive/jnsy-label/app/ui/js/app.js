/* =========================================================
   AI训练师训练平台 - 学员端完整版本 (app.js)
   功能：
   ✅ 登录检查
   ✅ 文本标注训练
   ✅ Python代码测试
   ✅ 数据统计
   ✅ 响应式UI
   ========================================================= */

(function() {
    // 配置
    const API_BASE = 'http://localhost:8001';
    const USE_MOCK_DATA = false;
    console.log('使用后端地址:', API_BASE);

    // 工具函数
    function $(id) {
        return document.getElementById(id);
    }

    function getToken() {
        return localStorage.getItem(TOKEN_KEY) || "";
    }

    function getUserPhone() {
        return localStorage.getItem(USER_PHONE_KEY) || "";
    }

    function apiHeaders() {
        const h = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        };
        const token = getToken();
        if (token) h["Authorization"] = `Bearer ${token}`;
        return h;
    }

    async function apiGet(path) {
    // 如果使用模拟数据，直接返回模拟响应
    if (typeof USE_MOCK_DATA !== 'undefined' && USE_MOCK_DATA) {
        return await mockApiResponse(path, 'GET');
    }
    
    try {
        const res = await fetch(`${API_BASE}${path}`, { headers: apiHeaders() });
        if (!res.ok) {
            if (res.status === 401) {
                localStorage.removeItem(TOKEN_KEY);
                window.location.href = '/ui/login.html';
                return null;
            }
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        return await res.json();
    } catch (error) {
        console.error('API GET Error:', error);
        showToast('请求失败: ' + error.message, 'error');
        
        // 如果定义了模拟数据，请求失败时使用模拟数据
        if (typeof mockApiResponse !== 'undefined') {
            showToast('使用模拟数据继续', 'info');
            return await mockApiResponse(path, 'GET');
        }
        
        return null;
    }
}

    async function apiPost(path, body) {
    // 如果使用模拟数据，直接返回模拟响应
    if (typeof USE_MOCK_DATA !== 'undefined' && USE_MOCK_DATA) {
        return await mockApiResponse(path, 'POST', body);
    }
    
    try {
        const res = await fetch(`${API_BASE}${path}`, {
            method: 'POST',
            headers: apiHeaders(),
            body: JSON.stringify(body || {})
        });
        
        if (!res.ok) {
            if (res.status === 401) {
                localStorage.removeItem(TOKEN_KEY);
                window.location.href = '/ui/login.html';
                return null;
            }
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        return await res.json();
    } catch (error) {
        console.error('API POST Error:', error);
        showToast('请求失败: ' + error.message, 'error');
        
        // 如果定义了模拟数据，请求失败时使用模拟数据
        if (typeof mockApiResponse !== 'undefined') {
            showToast('使用模拟数据继续', 'info');
            return await mockApiResponse(path, 'POST', body);
        }
        
        return null;
    }
}

    function showToast(message, type = 'info') {
        // 创建或获取toast容器
        let toastContainer = $('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                z-index: 10000;
                display: flex;
                flex-direction: column;
                gap: 10px;
            `;
            document.body.appendChild(toastContainer);
        }

        // 创建toast
        const toast = document.createElement('div');
        toast.style.cssText = `
            padding: 12px 20px;
            background: ${type === 'error' ? '#fee2e2' : type === 'success' ? '#d1fae5' : '#e0f2fe'};
            color: ${type === 'error' ? '#dc2626' : type === 'success' ? '#059669' : '#0369a1'};
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            display: flex;
            align-items: center;
            gap: 10px;
            animation: slideIn 0.3s ease-out;
        `;

        // 添加图标
        let icon = 'ℹ️';
        if (type === 'success') icon = '✅';
        if (type === 'error') icon = '❌';
        if (type === 'warning') icon = '⚠️';

        toast.innerHTML = `
            <span style="font-size: 16px;">${icon}</span>
            <span>${message}</span>
        `;

        toastContainer.appendChild(toast);

        // 自动移除
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease-out';
            setTimeout(() => {
                if (toast.parentNode) {
                    toast.parentNode.removeChild(toast);
                }
            }, 300);
        }, 3000);

        // 添加动画样式
        if (!$('toast-styles')) {
            const style = document.createElement('style');
            style.id = 'toast-styles';
            style.textContent = `
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes slideOut {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
    }

    // 应用状态
    const state = {
        currentModule: 'text', // text, python, stats
        currentTextType: 'sentiment', // sentiment, ner, intent
        currentQuestion: null,
        selectedLabel: '',
        textQuestions: { list: [], pool: [] },
        pythonQuestions: { list: [], pool: [] },
        labels: [
            { name: "正向", color: "#22c55e" },
            { name: "负向", color: "#ef4444" },
            { name: "中性", color: "#3b82f6" }
        ],
        userPhone: getUserPhone(),
        stats: {
            text: { total: 0, correct: 0, score: 0 },
            python: { total: 0, correct: 0, score: 0 }
        }
    };

    // UI组件
    function createElement(tag, attributes = {}, children = []) {
        const element = document.createElement(tag);
        
        // 设置属性
        Object.keys(attributes).forEach(key => {
            if (key === 'className') {
                element.className = attributes[key];
            } else if (key === 'style' && typeof attributes[key] === 'object') {
                Object.assign(element.style, attributes[key]);
            } else if (key.startsWith('on') && typeof attributes[key] === 'function') {
                element[key.toLowerCase()] = attributes[key];
            } else {
                element.setAttribute(key, attributes[key]);
            }
        });
        
        // 添加子元素
        children.forEach(child => {
            if (typeof child === 'string') {
                element.appendChild(document.createTextNode(child));
            } else if (child instanceof Node) {
                element.appendChild(child);
            } else if (Array.isArray(child)) {
                child.forEach(c => element.appendChild(c));
            }
        });
        
        return element;
    }

    // 创建侧边栏
    function createSidebar() {
        const modules = [
            { id: 'text', name: '文本标注', icon: '📝' },
            { id: 'python', name: 'Python测试', icon: '🐍' },
            { id: 'stats', name: '数据统计', icon: '📊' }
        ];

        const sidebar = createElement('div', {
            className: 'sidebar',
            style: {
                width: '250px',
                background: '#1e293b',
                color: 'white',
                display: 'flex',
                flexDirection: 'column',
                height: '100vh',
                position: 'fixed',
                left: '0',
                top: '0'
            }
        });

        // 品牌区域
        const brandSection = createElement('div', {
            style: {
                padding: '24px',
                borderBottom: '1px solid rgba(255,255,255,0.1)'
            }
        }, [
            createElement('h2', {
                style: {
                    margin: '0',
                    fontSize: '18px',
                    fontWeight: '600'
                }
            }, ['AI训练师']),
            createElement('p', {
                style: {
                    margin: '4px 0 0 0',
                    fontSize: '12px',
                    opacity: '0.8'
                }
            }, ['学员训练平台']),
            createElement('p', {
                style: {
                    margin: '8px 0 0 0',
                    fontSize: '11px',
                    opacity: '0.6'
                }
            }, [state.userPhone || '未登录'])
        ]);

        // 菜单区域
        const menuSection = createElement('div', {
            style: {
                padding: '16px',
                flexGrow: '1'
            }
        });

        modules.forEach(module => {
            const menuItem = createElement('div', {
                className: 'menu-item',
                onclick: () => switchModule(module.id),
                style: {
                    padding: '12px 16px',
                    marginBottom: '8px',
                    background: state.currentModule === module.id ? 'rgba(79, 70, 229, 0.2)' : 'transparent',
                    color: state.currentModule === module.id ? '#8b5cf6' : 'rgba(255,255,255,0.8)',
                    border: state.currentModule === module.id ? '1px solid rgba(79, 70, 229, 0.3)' : '1px solid transparent',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    transition: 'all 0.2s'
                }
            }, [
                createElement('span', {}, [module.icon]),
                createElement('span', { style: { fontSize: '14px' } }, [module.name])
            ]);
            menuSection.appendChild(menuItem);
        });

        // 底部区域
        const bottomSection = createElement('div', {
            style: {
                padding: '16px',
                borderTop: '1px solid rgba(255,255,255,0.1)'
            }
        }, [
            createElement('button', {
                className: 'logout-btn',
                onclick: logout,
                style: {
                    width: '100%',
                    padding: '10px',
                    background: 'rgba(239, 68, 68, 0.2)',
                    color: '#ef4444',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500'
                }
            }, ['退出登录'])
        ]);

        // 组装侧边栏
        sidebar.appendChild(brandSection);
        sidebar.appendChild(menuSection);
        sidebar.appendChild(bottomSection);

        return sidebar;
    }

    // 创建主内容区
    function createMainContent() {
        const content = createElement('div', {
            className: 'main-content',
            style: {
                marginLeft: '250px',
                padding: '20px',
                minHeight: '100vh',
                background: '#f5f5f5'
            }
        });
        
        // 顶部栏
        const topbar = createElement('div', {
            style: {
                background: 'white',
                padding: '16px 24px',
                borderRadius: '12px',
                marginBottom: '20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }
        }, [
            createElement('h1', {
                id: 'page-title',
                style: {
                    margin: '0',
                    fontSize: '20px',
                    fontWeight: '600',
                    color: '#1e293b'
                }
            }, ['页面标题']),
            createElement('div', {
                style: {
                    display: 'flex',
                    gap: '10px',
                    alignItems: 'center'
                }
            }, [
                createElement('span', {
                    style: {
                        fontSize: '14px',
                        color: '#64748b'
                    }
                }, [`欢迎, ${state.userPhone}`])
            ])
        ]);
        
        content.appendChild(topbar);
        
        // 页面内容区域
        const pageBody = createElement('div', {
            id: 'page-body',
            style: {
                minHeight: 'calc(100vh - 120px)'
            }
        });
        content.appendChild(pageBody);
        
        return content;
    }

    // 模块切换
    function switchModule(module) {
        state.currentModule = module;
        renderPage();
        const pageBody = $('page-body');
        pageBody.style.opacity = '0';
        pageBody.style.transform = 'translateY(10px)';

        setTimeout(() => {
            state.currentModule = module;
            renderPage();
            pageBody.style.transition = 'all 0.3s ease';
            pageBody.style.opacity = '1';
            pageBody.style.transform = 'translateY(0)';
        }, 200);
    }

    // 页面渲染
    function renderPage() {
        const titleMap = {
            'text': '文本标注训练',
            'python': 'Python代码测试',
            'stats': '数据统计'
        };
        
        $('page-title').textContent = titleMap[state.currentModule] || 'AI训练师';
        
        const pageBody = $('page-body');
        pageBody.innerHTML = '';
        
        switch (state.currentModule) {
            case 'text':
                renderTextModule(pageBody);
                break;
            case 'python':
                renderPythonModule(pageBody);
                break;
            case 'stats':
                renderStatsModule(pageBody);
                break;
        }
    }

    // 创建统计卡片
    function createStatCard(title, id, icon) {
        return createElement('div', {
            style: {
                background: 'white',
                padding: '20px',
                borderRadius: '12px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }
        }, [
            createElement('div', {
                style: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '12px'
                }
            }, [
                createElement('span', {
                    style: { fontSize: '20px' }
                }, [icon]),
                createElement('span', {
                    style: {
                        fontSize: '12px',
                        color: '#64748b',
                        fontWeight: '500'
                    }
                }, [title])
            ]),
            createElement('div', {
                id: id,
                style: {
                    fontSize: '24px',
                    fontWeight: '600',
                    color: '#1e293b'
                }
            }, ['0'])
        ]);
    }

    // 渲染标签
    function renderLabels() {
        const container = $('#labels-container');
        if (!container) return;
        
        container.innerHTML = '';
        
        state.labels.forEach(label => {
            const labelBtn = createElement('button', {
                onclick: () => selectLabel(label.name),
                style: {
                    padding: '8px 16px',
                    background: state.selectedLabel === label.name ? label.color + '20' : 'white',
                    color: state.selectedLabel === label.name ? label.color : '#374151',
                    border: `2px solid ${state.selectedLabel === label.name ? label.color : '#e5e7eb'}`,
                    borderRadius: '20px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    fontWeight: '500',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.2s'
                }
            }, [
                createElement('span', {
                    style: {
                        width: '12px',
                        height: '12px',
                        borderRadius: '50%',
                        background: label.color
                    }
                }),
                createElement('span', {}, [label.name])
            ]);
            
            container.appendChild(labelBtn);
        });
    }

    // 选择标签
    function selectLabel(labelName) {
        state.selectedLabel = labelName;
        $('#selected-label-display').textContent = labelName;
        renderLabels();
    }

    // 添加新标签
    function addNewLabel() {
        const nameInput = $('#new-label-name');
        const colorInput = $('#new-label-color');
        
        const name = nameInput.value.trim();
        const color = colorInput.value;
        
        if (!name) {
            showToast('请输入标签名称', 'warning');
            return;
        }
        
        if (state.labels.some(l => l.name === name)) {
            showToast('标签已存在', 'warning');
            return;
        }
        
        state.labels.push({ name, color });
        nameInput.value = '';
        renderLabels();
        showToast('标签添加成功', 'success');
    }

    // 加载文本统计
    async function loadTextStats() {
        try {
            const history = await apiGet('/questions/me/history');
            if (!history) return;
            
            const textHistory = Array.isArray(history) ? history : [];
            const textStats = {
                total: textHistory.length,
                correct: textHistory.filter(h => h.is_correct).length,
                score: textHistory.reduce((sum, h) => sum + (h.score || 0), 0)
            };
            
            $('text-total').textContent = textStats.total;
            $('text-correct').textContent = textStats.correct;
            
            const accuracy = textStats.total > 0 ? 
                Math.round((textStats.correct / textStats.total) * 100) : 0;
            $('text-accuracy').textContent = `${accuracy}%`;
            
            $('text-score').textContent = textStats.score;
            
        } catch (error) {
            console.error('加载统计失败:', error);
        }
    }

    // 获取随机文本题目
    async function getRandomTextQuestion() {
        try {
            showToast('正在获取题目...', 'info');
            
            // 先获取题目列表
            if (state.textQuestions.list.length === 0) {
                const questions = await apiGet('/questions?type=text_classification');
                if (questions && Array.isArray(questions)) {
                    state.textQuestions.list = questions.map(q => q.id);
                    state.textQuestions.pool = [...state.textQuestions.list];
                }
            }
            
            // 如果题库为空
            if (state.textQuestions.pool.length === 0) {
                if (state.textQuestions.list.length > 0) {
                    state.textQuestions.pool = [...state.textQuestions.list];
                } else {
                    showToast('没有可用的文本题目', 'warning');
                    return;
                }
            }
            
            // 随机选择一题
            const randomIndex = Math.floor(Math.random() * state.textQuestions.pool.length);
            const questionId = state.textQuestions.pool.splice(randomIndex, 1)[0];
            
            // 获取题目详情
            const question = await apiGet(`/questions/${questionId}`);
            if (!question) return;
            
            state.currentQuestion = question;
            state.selectedLabel = '';
            $('#selected-label-display').textContent = '未选择';
            
            // 显示题目
            $('#question-stem').textContent = question.stem || '无题目要求';
            const text = question.payload?.text || question.payload?.question_text || '无文本内容';
            $('#question-text').textContent = text;
            
            $('#result-display').textContent = '提交后显示结果';
            $('#question-hint').textContent = '请选择标签后提交答案';
            
            showToast('题目加载成功', 'success');
            
        } catch (error) {
            console.error('获取题目失败:', error);
            showToast('获取题目失败: ' + error.message, 'error');
        }
    }

    // 提交文本答案
    async function submitTextAnswer() {
        if (!state.currentQuestion) {
            showToast('请先获取题目', 'warning');
            return;
        }
        
        if (!state.selectedLabel) {
            showToast('请先选择标签', 'warning');
            return;
        }
        
        try {
            showToast('正在提交答案...', 'info');
            
            const result = await apiPost(`/questions/${state.currentQuestion.id}/submit`, {
                selected_label: state.selectedLabel
            });
            
            if (!result) return;
            
            // 显示结果
            let resultHTML = `
                <div style="margin-bottom: 12px;">
                    <span style="padding: 6px 12px; background: ${result.is_correct ? '#d1fae5' : '#fee2e2'}; 
                          color: ${result.is_correct ? '#059669' : '#dc2626'}; border-radius: 20px; font-weight: 500;">
                        ${result.is_correct ? '✅ 正确' : '❌ 错误'}
                    </span>
                    <span style="margin-left: 12px; color: #64748b;">得分: ${result.score || 0}</span>
                </div>
            `;
            
            if (!result.is_correct && result.correct_label) {
                resultHTML += `
                    <div style="margin-top: 8px;">
                        <span style="color: #64748b;">正确答案: </span>
                        <span style="color: #059669; font-weight: 500;">${result.correct_label}</span>
                    </div>
                `;
            }
            
            if (result.explanation) {
                resultHTML += `
                    <div style="margin-top: 12px; padding: 12px; background: #f8fafc; border-radius: 8px; border-left: 3px solid #3b82f6;">
                        <span style="color: #64748b;">解析: </span>${result.explanation}
                    </div>
                `;
            }
            
            $('#result-display').innerHTML = resultHTML;
            
            // 更新统计
            await loadTextStats();
            
            showToast('提交成功', 'success');
            
        } catch (error) {
            console.error('提交答案失败:', error);
            showToast('提交失败: ' + error.message, 'error');
        }
    }

    // 渲染文本标注模块
    function renderTextModule(container) {
        // 统计卡片
        const statsRow = createElement('div', {
            style: {
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '16px',
                marginBottom: '24px'
            }
        }, [
            createStatCard('已完成', 'text-total', '📝'),
            createStatCard('正确数', 'text-correct', '✅'),
            createStatCard('正确率', 'text-accuracy', '📈'),
            createStatCard('总得分', 'text-score', '🏆')
        ]);
        
        container.appendChild(statsRow);
        
        // 标签管理区域
        const labelSection = createElement('div', {
            style: {
                background: 'white',
                borderRadius: '12px',
                padding: '24px',
                marginBottom: '20px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }
        }, [
            createElement('h3', {
                style: {
                    margin: '0 0 16px 0',
                    fontSize: '16px',
                    fontWeight: '600'
                }
            }, ['标签管理']),
            
            // 新建标签
            createElement('div', {
                style: {
                    display: 'flex',
                    gap: '12px',
                    marginBottom: '20px',
                    alignItems: 'center'
                }
            }, [
                createElement('input', {
                    id: 'new-label-name',
                    placeholder: '新标签名称',
                    style: {
                        flex: '1',
                        padding: '10px 12px',
                        border: '1px solid #e5e7eb',
                        borderRadius: '6px',
                        fontSize: '14px'
                    }
                }),
                createElement('input', {
                    id: 'new-label-color',
                    type: 'color',
                    defaultValue: '#22c55e',
                    style: {
                        width: '40px',
                        height: '40px',
                        padding: '0',
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer'
                    }
                }),
                createElement('button', {
                    onclick: addNewLabel,
                    style: {
                        padding: '10px 20px',
                        background: '#4f46e5',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: '500'
                    }
                }, ['添加标签'])
            ]),
            
            // 标签显示
            createElement('div', {
                id: 'labels-container',
                style: {
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '10px',
                    minHeight: '50px'
                }
            }, [])
        ]);
        
        container.appendChild(labelSection);
        
        // 题目区域
        const questionSection = createElement('div', {
            style: {
                background: 'white',
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }
        }, [
            createElement('div', {
                style: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px'
                }
            }, [
                createElement('div', {}, [
                    createElement('h3', {
                        style: {
                            margin: '0 0 4px 0',
                            fontSize: '16px',
                            fontWeight: '600'
                        }
                    }, ['文本标注训练']),
                    createElement('p', {
                        id: 'question-hint',
                        style: {
                            margin: '0',
                            fontSize: '14px',
                            color: '#64748b'
                        }
                    }, ['点击"随机来一题"开始训练'])
                ]),
                createElement('div', {
                    style: {
                        display: 'flex',
                        gap: '12px'
                    }
                }, [
                    createElement('button', {
                        onclick: getRandomTextQuestion,
                        style: {
                            padding: '10px 20px',
                            background: '#f3f4f6',
                            color: '#374151',
                            border: '1px solid #e5e7eb',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: '500'
                        }
                    }, ['随机来一题']),
                    createElement('button', {
                        onclick: submitTextAnswer,
                        style: {
                            padding: '10px 20px',
                            background: '#4f46e5',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: '500'
                        }
                    }, ['提交答案'])
                ])
            ]),
            
            // 题目内容
            createElement('div', {
                style: {
                    marginBottom: '20px'
                }
            }, [
                createElement('h4', {
                    style: {
                        margin: '0 0 8px 0',
                        fontSize: '14px',
                        color: '#64748b'
                    }
                }, ['题目要求']),
                createElement('div', {
                    id: 'question-stem',
                    style: {
                        padding: '16px',
                        background: '#f8fafc',
                        borderRadius: '8px',
                        fontSize: '15px',
                        lineHeight: '1.6'
                    }
                }, ['请点击"随机来一题"获取题目'])
            ]),
            
            createElement('div', {
                style: {
                    marginBottom: '20px'
                }
            }, [
                createElement('h4', {
                    style: {
                        margin: '0 0 8px 0',
                        fontSize: '14px',
                        color: '#64748b'
                    }
                }, ['文本内容']),
                createElement('div', {
                    id: 'question-text',
                    style: {
                        padding: '16px',
                        background: '#f8fafc',
                        borderRadius: '8px',
                        fontSize: '15px',
                        lineHeight: '1.6',
                        minHeight: '100px'
                    }
                }, ['等待题目...'])
            ]),
            
            // 当前选择
            createElement('div', {
                style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '16px',
                    background: '#f8fafc',
                    borderRadius: '8px',
                    marginBottom: '20px'
                }
            }, [
                createElement('span', {
                    style: { fontSize: '14px', color: '#64748b' }
                }, ['当前选择:']),
                createElement('span', {
                    id: 'selected-label-display',
                    style: {
                        padding: '6px 12px',
                        background: '#e0f2fe',
                        color: '#0369a1',
                        borderRadius: '20px',
                        fontSize: '14px',
                        fontWeight: '500'
                    }
                }, ['未选择'])
            ]),
            
            // 结果展示
            createElement('div', {}, [
                createElement('h4', {
                    style: {
                        margin: '0 0 8px 0',
                        fontSize: '14px',
                        color: '#64748b'
                    }
                }, ['判分结果']),
                createElement('div', {
                    id: 'result-display',
                    style: {
                        padding: '20px',
                        background: '#f8fafc',
                        borderRadius: '8px',
                        minHeight: '100px',
                        fontSize: '14px',
                        lineHeight: '1.6'
                    }
                }, ['提交后显示结果'])
            ])
        ]);
        
        container.appendChild(questionSection);
        
        // 初始化标签显示
        renderLabels();
        // 加载统计
        loadTextStats();
    }

    // 加载Python统计
    async function loadPythonStats() {
        try {
            // 这里简化处理，实际应该从后端获取Python题目的统计
            // 暂时显示为0
            $('python-total').textContent = '0';
            $('python-correct').textContent = '0';
            $('python-accuracy').textContent = '0%';
            $('python-score').textContent = '0';
        } catch (error) {
            console.error('加载Python统计失败:', error);
        }
    }

    // 获取随机Python题目
    async function getRandomPythonQuestion() {
        try {
            showToast('正在获取Python题目...', 'info');
            
            // 先获取题目列表
            if (state.pythonQuestions.list.length === 0) {
                const questions = await apiGet('/questions?type=python');
                if (questions && Array.isArray(questions)) {
                    state.pythonQuestions.list = questions.map(q => q.id);
                    state.pythonQuestions.pool = [...state.pythonQuestions.list];
                }
            }
            
            // 如果题库为空
            if (state.pythonQuestions.pool.length === 0) {
                if (state.pythonQuestions.list.length > 0) {
                    state.pythonQuestions.pool = [...state.pythonQuestions.list];
                } else {
                    showToast('没有可用的Python题目', 'warning');
                    return;
                }
            }
            
            // 随机选择一题
            const randomIndex = Math.floor(Math.random() * state.pythonQuestions.pool.length);
            const questionId = state.pythonQuestions.pool.splice(randomIndex, 1)[0];
            
            // 获取题目详情
            const question = await apiGet(`/questions/${questionId}`);
            if (!question) return;
            
            state.currentQuestion = question;
            
            // 显示题目
            $('#python-qid').textContent = question.id;
            $('#python-status').textContent = '已加载';
            $('#python-stem').textContent = question.stem || '无题目要求';
            
            // 设置初始代码
            const starterCode = question.payload?.starter_code || '# 在这里输入你的代码\nprint("Hello World")';
            $('#python-editor').value = starterCode;
            
            $('#python-run-output').textContent = '运行后显示结果';
            $('#python-judge-output').textContent = '提交后显示结果';
            $('#python-hint').textContent = '请编写代码并运行测试';
            
            showToast('Python题目加载成功', 'success');
            
        } catch (error) {
            console.error('获取Python题目失败:', error);
            showToast('获取题目失败: ' + error.message, 'error');
        }
    }

    // 运行Python代码
    async function runPythonCode() {
        if (!state.currentQuestion) {
            showToast('请先获取题目', 'warning');
            return;
        }
        
        const code = $('#python-editor').value;
        if (!code.trim()) {
            showToast('请输入代码', 'warning');
            return;
        }
        
        try {
            showToast('正在运行代码...', 'info');
            
            const result = await apiPost(`/questions/${state.currentQuestion.id}/run`, {
                code: code
            });
            
            if (!result) return;
            
            let output = '';
            if (result.stdout) {
                output += `标准输出:\n${result.stdout}\n\n`;
            }
            if (result.stderr) {
                output += `错误输出:\n${result.stderr}\n`;
            }
            if (!result.stdout && !result.stderr) {
                output = '运行完成，无输出';
            }
            
            $('#python-run-output').textContent = output;
            
            if (result.ok) {
                showToast('代码运行成功', 'success');
            } else {
                showToast('代码运行有错误', 'warning');
            }
            
        } catch (error) {
            console.error('运行代码失败:', error);
            showToast('运行失败: ' + error.message, 'error');
        }
    }

    // 提交Python代码
    async function submitPythonCode() {
        if (!state.currentQuestion) {
            showToast('请先获取题目', 'warning');
            return;
        }
        
        const code = $('#python-editor').value;
        if (!code.trim()) {
            showToast('请输入代码', 'warning');
            return;
        }
        
        try {
            showToast('正在提交判分...', 'info');
            
            const result = await apiPost(`/questions/${state.currentQuestion.id}/python_submit`, {
                code: code
            });
            
            if (!result) return;
            
            let output = '';
            if (result.is_correct !== undefined) {
                output += `判分结果: ${result.is_correct ? '✅ 正确' : '❌ 错误'}\n`;
            }
            if (result.score !== undefined) {
                output += `得分: ${result.score}\n`;
            }
            if (result.stdout) {
                output += `\n标准输出:\n${result.stdout}\n`;
            }
            if (result.stderr) {
                output += `\n错误输出:\n${result.stderr}\n`;
            }
            if (result.explanation) {
                output += `\n解析: ${result.explanation}\n`;
            }
            
            $('#python-judge-output').textContent = output;
            
            if (result.is_correct) {
                showToast('提交成功，答案正确！', 'success');
            } else {
                showToast('提交成功，答案有误', 'warning');
            }
            
            // 更新统计
            await loadPythonStats();
            
        } catch (error) {
            console.error('提交代码失败:', error);
            showToast('提交失败: ' + error.message, 'error');
        }
    }

    // 渲染Python模块
    function renderPythonModule(container) {
        // Python统计卡片
        const statsRow = createElement('div', {
            style: {
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '16px',
                marginBottom: '24px'
            }
        }, [
            createStatCard('已完成', 'python-total', '🐍'),
            createStatCard('正确数', 'python-correct', '✅'),
            createStatCard('正确率', 'python-accuracy', '📈'),
            createStatCard('总得分', 'python-score', '🏆')
        ]);
        
        container.appendChild(statsRow);
        
        // Python代码编辑区域
        const pythonSection = createElement('div', {
            style: {
                background: 'white',
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }
        }, [
            createElement('div', {
                style: {
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '20px'
                }
            }, [
                createElement('div', {}, [
                    createElement('h3', {
                        style: {
                            margin: '0 0 4px 0',
                            fontSize: '16px',
                            fontWeight: '600'
                        }
                    }, ['Python代码测试']),
                    createElement('p', {
                        id: 'python-hint',
                        style: {
                            margin: '0',
                            fontSize: '14px',
                            color: '#64748b'
                        }
                    }, ['点击"随机来一题"开始测试'])
                ]),
                createElement('div', {
                    style: {
                        display: 'flex',
                        gap: '12px'
                    }
                }, [
                    createElement('button', {
                        onclick: getRandomPythonQuestion,
                        style: {
                            padding: '10px 20px',
                            background: '#f3f4f6',
                            color: '#374151',
                            border: '1px solid #e5e7eb',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: '500'
                        }
                    }, ['随机来一题']),
                    createElement('button', {
                        onclick: runPythonCode,
                        style: {
                            padding: '10px 20px',
                            background: '#0ea5e9',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: '500'
                        }
                    }, ['运行代码']),
                    createElement('button', {
                        onclick: submitPythonCode,
                        style: {
                            padding: '10px 20px',
                            background: '#4f46e5',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            fontWeight: '500'
                        }
                    }, ['提交判分'])
                ])
            ]),
            
            // 题目信息
            createElement('div', {
                style: {
                    marginBottom: '20px'
                }
            }, [
                createElement('div', {
                    style: {
                        display: 'flex',
                        gap: '20px',
                        marginBottom: '12px'
                    }
                }, [
                    createElement('div', {
                        style: {
                            fontSize: '14px',
                            color: '#64748b'
                        }
                    }, [
                        createElement('span', { style: { fontWeight: '500' } }, ['题号: ']),
                        createElement('span', { id: 'python-qid' }, ['-'])
                    ]),
                    createElement('div', {
                        style: {
                            fontSize: '14px',
                            color: '#64748b'
                        }
                    }, [
                        createElement('span', { style: { fontWeight: '500' } }, ['状态: ']),
                        createElement('span', { id: 'python-status' }, ['未开始'])
                    ])
                ]),
                createElement('div', {
                    style: {
                        padding: '16px',
                        background: '#f8fafc',
                        borderRadius: '8px',
                        fontSize: '15px',
                        lineHeight: '1.6'
                    }
                }, [
                    createElement('h4', {
                        style: {
                            margin: '0 0 8px 0',
                            fontSize: '14px',
                            color: '#64748b'
                        }
                    }, ['题目要求']),
                    createElement('div', { id: 'python-stem' }, ['请点击"随机来一题"获取题目'])
                ])
            ]),
            
            // 代码编辑器
            createElement('div', {
                style: {
                    marginBottom: '20px'
                }
            }, [
                createElement('h4', {
                    style: {
                        margin: '0 0 8px 0',
                        fontSize: '14px',
                        color: '#64748b'
                    }
                }, ['代码编辑器']),
                createElement('textarea', {
                    id: 'python-editor',
                    style: {
                        width: '100%',
                        height: '300px',
                        padding: '16px',
                        fontFamily: 'monospace',
                        fontSize: '14px',
                        lineHeight: '1.5',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        resize: 'vertical',
                        background: '#1e293b',
                        color: '#e2e8f0'
                    },
                    placeholder: '输入Python代码...'
                })
            ]),
            
            // 输出结果区域（两列布局）
            createElement('div', {
                style: {
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '20px'
                }
            }, [
                // 运行输出
                createElement('div', {
                    style: {
                        background: '#f8fafc',
                        borderRadius: '8px',
                        padding: '16px'
                    }
                }, [
                    createElement('h4', {
                        style: {
                            margin: '0 0 12px 0',
                            fontSize: '14px',
                            color: '#64748b'
                        }
                    }, ['运行输出']),
                    createElement('div', {
                        id: 'python-run-output',
                        style: {
                            fontFamily: 'monospace',
                            fontSize: '13px',
                            whiteSpace: 'pre-wrap',
                            background: 'white',
                            padding: '12px',
                            borderRadius: '6px',
                            border: '1px solid #e5e7eb',
                            minHeight: '150px',
                            maxHeight: '300px',
                            overflow: 'auto'
                        }
                    }, ['运行后显示结果'])
                ]),
                
                // 判分结果
                createElement('div', {
                    style: {
                        background: '#f8fafc',
                        borderRadius: '8px',
                        padding: '16px'
                    }
                }, [
                    createElement('h4', {
                        style: {
                            margin: '0 0 12px 0',
                            fontSize: '14px',
                            color: '#64748b'
                        }
                    }, ['判分结果']),
                    createElement('div', {
                        id: 'python-judge-output',
                        style: {
                            fontFamily: 'monospace',
                            fontSize: '13px',
                            whiteSpace: 'pre-wrap',
                            background: 'white',
                            padding: '12px',
                            borderRadius: '6px',
                            border: '1px solid #e5e7eb',
                            minHeight: '150px',
                            maxHeight: '300px',
                            overflow: 'auto'
                        }
                    }, ['提交后显示结果'])
                ])
            ])
        ]);
        
        container.appendChild(pythonSection);
        
        // 加载Python统计
        loadPythonStats();
    }

    // 加载所有统计
    async function loadAllStats() {
        try {
            showToast('正在加载统计数据...', 'info');
            
            const history = await apiGet('/questions/me/history');
            if (!history || !Array.isArray(history)) {
                $('#stats-history').textContent = '暂无答题记录';
                return;
            }
            
            const total = history.length;
            const correct = history.filter(h => h.is_correct).length;
            const score = history.reduce((sum, h) => sum + (h.score || 0), 0);
            const accuracy = total > 0 ? Math.round((correct / total) * 100) : 0;
            
            // 更新总体统计
            $('#stats-total').textContent = total;
            $('#stats-accuracy').textContent = `${accuracy}%`;
            $('#stats-score').textContent = score;
            
            // 显示最近记录
            const recentHistory = history.slice(0, 20); // 显示最近20条
            
            if (recentHistory.length === 0) {
                $('#stats-history').innerHTML = '<p style="text-align: center; color: #64748b;">暂无答题记录</p>';
                return;
            }
            
            let historyHTML = '<div style="display: flex; flex-direction: column; gap: 12px;">';
            
            recentHistory.forEach(record => {
                const time = record.created_at ? new Date(record.created_at).toLocaleString() : '未知时间';
                const type = record.type || record.question_type || '未知类型';
                
                historyHTML += `
                    <div style="
                        background: white;
                        padding: 12px;
                        border-radius: 8px;
                        border-left: 4px solid ${record.is_correct ? '#22c55e' : '#ef4444'};
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                    ">
                        <div>
                            <div style="font-weight: 500; color: #1e293b;">${type}</div>
                            <div style="font-size: 12px; color: #64748b;">${time}</div>
                        </div>
                        <div style="text-align: right;">
                            <div style="color: ${record.is_correct ? '#22c55e' : '#ef4444'}; font-weight: 500;">
                                ${record.is_correct ? '✅ 正确' : '❌ 错误'}
                            </div>
                            <div style="font-size: 12px; color: #64748b;">得分: ${record.score || 0}</div>
                        </div>
                    </div>
                `;
            });
            
            historyHTML += '</div>';
            $('#stats-history').innerHTML = historyHTML;
            
            showToast('统计数据加载完成', 'success');
            
        } catch (error) {
            console.error('加载统计数据失败:', error);
            $('#stats-history').textContent = '加载失败: ' + error.message;
        }
    }

    // 渲染统计模块
    function renderStatsModule(container) {
        const statsSection = createElement('div', {
            style: {
                background: 'white',
                borderRadius: '12px',
                padding: '24px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
            }
        }, [
            createElement('h3', {
                style: {
                    margin: '0 0 20px 0',
                    fontSize: '16px',
                    fontWeight: '600'
                }
            }, ['学习数据统计']),
            
            // 总体统计
            createElement('div', {
                style: {
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: '16px',
                    marginBottom: '30px'
                }
            }, [
                createElement('div', {
                    style: {
                        padding: '20px',
                        background: '#f0f9ff',
                        borderRadius: '12px',
                        textAlign: 'center'
                    }
                }, [
                    createElement('div', {
                        style: {
                            fontSize: '12px',
                            color: '#0369a1',
                            marginBottom: '8px'
                        }
                    }, ['总答题数']),
                    createElement('div', {
                        id: 'stats-total',
                        style: {
                            fontSize: '28px',
                            fontWeight: '600',
                            color: '#0369a1'
                        }
                    }, ['0'])
                ]),
                createElement('div', {
                    style: {
                        padding: '20px',
                        background: '#f0fdf4',
                        borderRadius: '12px',
                        textAlign: 'center'
                    }
                }, [
                    createElement('div', {
                        style: {
                            fontSize: '12px',
                            color: '#059669',
                            marginBottom: '8px'
                        }
                    }, ['正确率']),
                    createElement('div', {
                        id: 'stats-accuracy',
                        style: {
                            fontSize: '28px',
                            fontWeight: '600',
                            color: '#059669'
                        }
                    }, ['0%'])
                ]),
                createElement('div', {
                    style: {
                        padding: '20px',
                        background: '#fef2f2',
                        borderRadius: '12px',
                        textAlign: 'center'
                    }
                }, [
                    createElement('div', {
                        style: {
                            fontSize: '12px',
                            color: '#dc2626',
                            marginBottom: '8px'
                        }
                    }, ['总得分']),
                    createElement('div', {
                        id: 'stats-score',
                        style: {
                            fontSize: '28px',
                            fontWeight: '600',
                            color: '#dc2626'
                        }
                    }, ['0'])
                ])
            ]),
            
            // 历史记录
            createElement('div', {}, [
                createElement('h4', {
                    style: {
                        margin: '0 0 16px 0',
                        fontSize: '14px',
                        color: '#64748b'
                    }
                }, ['最近答题记录']),
                createElement('div', {
                    id: 'stats-history',
                    style: {
                        background: '#f8fafc',
                        borderRadius: '8px',
                        padding: '16px',
                        minHeight: '200px',
                        maxHeight: '400px',
                        overflow: 'auto'
                    }
                }, ['正在加载历史记录...'])
            ]),
            
            // 刷新按钮
            createElement('button', {
                onclick: loadAllStats,
                style: {
                    marginTop: '20px',
                    padding: '10px 20px',
                    background: '#4f46e5',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontWeight: '500',
                    width: '100%'
                }
            }, ['刷新统计数据'])
        ]);
        
        container.appendChild(statsSection);
        
        // 加载统计数据
        loadAllStats();
    }

    // 登出函数
    function logout() {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_PHONE_KEY);
        window.location.href = '/ui/login.html';
    }

    // 初始化应用
    function init() {
        console.log('初始化AI训练师应用');
        
        // 检查登录状态
        const token = getToken();
        if (!token) {
            console.warn('未检测到登录token，跳转到登录页');
            window.location.href = '/ui/login.html';
            return;
        }
        
        // 保存用户信息
        if (!state.userPhone) {
            state.userPhone = localStorage.getItem('user_phone') || '学员';
        }
        
        // 获取应用容器
        const appEl = document.getElementById('app');
        if (!appEl) {
            console.error('找不到 #app 元素');
            return;
        }
        
        // 清除内容
        appEl.innerHTML = '';
        
        // 创建侧边栏和主内容
        const sidebar = createSidebar();
        const mainContent = createMainContent();
        
        // 添加到应用容器
        appEl.appendChild(sidebar);
        appEl.appendChild(mainContent);
        
        // 显示应用容器
        appEl.classList.add('show');
        
        // 默认加载文本标注模块
        setTimeout(() => {
            renderPage();
            showToast('欢迎回来！', 'success');
        }, 100);
    }

    // 全局导出
    window.mountUI = init;
    window.initApp = init;
    window.logout = logout;
    window.boot = init;
    window.switchModule = switchModule;
    window.getRandomTextQuestion = getRandomTextQuestion;
    window.submitTextAnswer = submitTextAnswer;
    window.getRandomPythonQuestion = getRandomPythonQuestion;
    window.runPythonCode = runPythonCode;
    window.submitPythonCode = submitPythonCode;
    
    // 自动初始化
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();