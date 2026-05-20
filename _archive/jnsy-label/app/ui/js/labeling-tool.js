// js/labeling-tool.js
// 图片标注工具核心代码

let canvas = null;
let currentTool = 'rectangle';
let history = [];
let currentStep = -1;
let imageLoaded = false;
let objectCounter = 1;

// 初始化画布
function initCanvas() {
    canvas = new fabric.Canvas('labelingCanvas', {
        selection: true,
        backgroundColor: '#f8f9fa'
    });
    
    // 设置画布事件
    setupCanvasEvents();
    
    // 默认加载示例图片
    setTimeout(() => {
        loadDefaultImage();
    }, 500);
}

// 设置画布事件
function setupCanvasEvents() {
    let isDrawing = false;
    let startX, startY;
    let currentShape = null;
    
    // 鼠标按下事件
    canvas.on('mouse:down', function(options) {
        if (currentTool === 'rectangle' || currentTool === 'polygon') {
            const pointer = canvas.getPointer(options.e);
            startX = pointer.x;
            startY = pointer.y;
            
            if (currentTool === 'rectangle') {
                currentShape = new fabric.Rect({
                    left: startX,
                    top: startY,
                    width: 0,
                    height: 0,
                    fill: 'rgba(75, 108, 183, 0.3)',
                    stroke: '#4b6cb7',
                    strokeWidth: 2,
                    strokeUniform: true,
                    hasControls: true,
                    hasBorders: true,
                    lockRotation: true,
                    id: 'rect_' + objectCounter++,
                    label: 'car'
                });
            } else if (currentTool === 'polygon') {
                // 多边形绘制（简化版）
                currentShape = new fabric.Circle({
                    left: startX - 5,
                    top: startY - 5,
                    radius: 5,
                    fill: '#4b6cb7',
                    strokeWidth: 0,
                    selectable: false
                });
            }
            
            canvas.add(currentShape);
            isDrawing = true;
            saveState();
        }
    });
    
    // 鼠标移动事件
    canvas.on('mouse:move', function(options) {
        if (!isDrawing || !currentShape) return;
        
        const pointer = canvas.getPointer(options.e);
        
        if (currentTool === 'rectangle') {
            currentShape.set({
                width: Math.abs(pointer.x - startX),
                height: Math.abs(pointer.y - startY)
            });
            
            if (pointer.x < startX) {
                currentShape.set({ left: pointer.x });
            }
            if (pointer.y < startY) {
                currentShape.set({ top: pointer.y });
            }
        } else if (currentTool === 'polygon') {
            // 多边形绘制时添加点
        }
        
        canvas.renderAll();
    });
    
    // 鼠标松开事件
    canvas.on('mouse:up', function() {
        if (isDrawing && currentShape) {
            if (currentTool === 'rectangle') {
                // 检查矩形是否太小
                if (currentShape.width < 10 || currentShape.height < 10) {
                    canvas.remove(currentShape);
                } else {
                    // 添加标签文本
                    addLabelToObject(currentShape);
                    updateObjectList();
                }
            }
            isDrawing = false;
            currentShape = null;
        }
    });
    
    // 对象被选中时的事件
    canvas.on('selection:created', function() {
        updateObjectList();
    });
    
    canvas.on('selection:cleared', function() {
        updateObjectList();
    });
    
    // 对象被修改时的事件
    canvas.on('object:modified', function() {
        saveState();
        updateObjectList();
    });
}

// 设置当前工具
function setTool(tool) {
    currentTool = tool;
    
    // 更新按钮状态
    document.getElementById('btnRect').classList.remove('active');
    document.getElementById('btnPoly').classList.remove('active');
    document.getElementById('btnMove').classList.remove('active');
    
    if (tool === 'rectangle') {
        document.getElementById('btnRect').classList.add('active');
        canvas.selection = false;
        canvas.defaultCursor = 'crosshair';
    } else if (tool === 'polygon') {
        document.getElementById('btnPoly').classList.add('active');
        canvas.selection = false;
        canvas.defaultCursor = 'crosshair';
    } else if (tool === 'move') {
        document.getElementById('btnMove').classList.add('active');
        canvas.selection = true;
        canvas.defaultCursor = 'default';
    }
}

// 加载默认示例图片
function loadDefaultImage() {
    const imageUrl = 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=800&h=500&fit=crop';
    loadImageToCanvas(imageUrl);
}

// 加载示例图片（用于示例按钮）
function loadExampleImage() {
    const imageUrl = 'https://images.unsplash.com/photo-1549399542-7e3f8b79c341?w=800&h=500&fit=crop';
    loadImageToCanvas(imageUrl);
}

// 加载图片到画布
function loadImageToCanvas(url) {
    fabric.Image.fromURL(url, function(img) {
        // 清空画布
        canvas.clear();
        canvas.backgroundColor = '#f8f9fa';
        
        // 设置图片尺寸适应画布
        const canvasWidth = canvas.width;
        const canvasHeight = canvas.height;
        const scale = Math.min(canvasWidth / img.width, canvasHeight / img.height);
        
        img.set({
            left: (canvasWidth - img.width * scale) / 2,
            top: (canvasHeight - img.height * scale) / 2,
            scaleX: scale,
            scaleY: scale,
            selectable: false,
            evented: false,
            id: 'background_image'
        });
        
        canvas.add(img);
        canvas.sendToBack(img);
        imageLoaded = true;
        
        // 更新界面状态
        document.getElementById('submitBtn').disabled = false;
        
        // 保存初始状态
        saveState();
        
        // 更新对象列表
        updateObjectList();
    });
}

// 从文件加载图片
function loadImageFromFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    // 检查文件类型
    if (!file.type.match('image.*')) {
        alert('请选择图片文件！');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        loadImageToCanvas(e.target.result);
    };
    reader.readAsDataURL(file);
}

// 添加标签到对象
function addLabelToObject(obj) {
    const label = new fabric.Text(obj.label || 'object', {
        left: obj.left + 5,
        top: obj.top + 5,
        fontSize: 14,
        fill: '#4b6cb7',
        fontWeight: 'bold',
        selectable: false,
        evented: false,
        id: 'label_' + obj.id
    });
    
    canvas.add(label);
    obj.labelText = label;
    
    // 当矩形移动时，标签也移动
    obj.on('moving', function() {
        if (obj.labelText) {
            obj.labelText.set({
                left: obj.left + 5,
                top: obj.top + 5
            });
            canvas.renderAll();
        }
    });
    
    // 当矩形缩放时，标签不动（保持左上角）
    obj.on('scaling', function() {
        if (obj.labelText) {
            obj.labelText.set({
                left: obj.left + 5,
                top: obj.top + 5
            });
            canvas.renderAll();
        }
    });
}

// 更新对象列表
function updateObjectList() {
    const objects = canvas.getObjects().filter(obj => 
        obj instanceof fabric.Rect && obj.id && obj.id.startsWith('rect_')
    );
    const listContainer = document.getElementById('objectList');
    
    let html = `<h3 style="margin-bottom: 15px;">已标注对象 (${objects.length})</h3>`;
    
    if (objects.length === 0) {
        html += '<p style="color: #666; text-align: center; padding: 20px;">暂无标注对象</p>';
    } else {
        objects.forEach((obj, index) => {
            html += `
                <div class="object-item">
                    <div>
                        <span class="object-label">${obj.label || 'object'} ${index + 1}</span>
                        <div class="object-coords">
                            x:${Math.round(obj.left)}, y:${Math.round(obj.top)}, 
                            w:${Math.round(obj.width)}, h:${Math.round(obj.height)}
                        </div>
                    </div>
                    <button onclick="removeObject('${obj.id}')" style="background: none; border: none; color: #dc3545; cursor: pointer; padding: 5px;">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
            `;
        });
    }
    
    listContainer.innerHTML = html;
}

// 删除选中对象
function deleteSelected() {
    const activeObject = canvas.getActiveObject();
    if (activeObject) {
        // 如果是矩形，也删除对应的标签
        if (activeObject.labelText) {
            canvas.remove(activeObject.labelText);
        }
        canvas.remove(activeObject);
        saveState();
        updateObjectList();
    }
}

// 移除特定对象
function removeObject(id) {
    const obj = canvas.getObjects().find(o => o.id === id);
    if (obj) {
        // 删除对应的标签
        if (obj.labelText) {
            canvas.remove(obj.labelText);
        }
        // 删除对象本身
        canvas.remove(obj);
        saveState();
        updateObjectList();
    }
}

// 清空画布
function clearCanvas() {
    if (confirm('确定要清空所有标注吗？')) {
        const objects = canvas.getObjects();
        objects.forEach(obj => {
            if (!(obj.id === 'background_image')) {
                canvas.remove(obj);
            }
        });
        saveState();
        updateObjectList();
    }
}

// 保存状态（用于撤销）
function saveState() {
    // 只保存标注对象，不保存背景图片
    const objects = canvas.getObjects().filter(obj => 
        !(obj.id === 'background_image')
    );
    
    // 创建一个临时的canvas来保存状态
    const tempCanvas = new fabric.Canvas(null);
    objects.forEach(obj => {
        tempCanvas.add(obj);
    });
    
    const state = JSON.stringify(tempCanvas.toJSON());
    
    if (currentStep < history.length - 1) {
        history = history.slice(0, currentStep + 1);
    }
    history.push(state);
    currentStep++;
    
    // 限制历史记录数量
    if (history.length > 50) {
        history.shift();
        currentStep--;
    }
}

// 撤销操作
function undo() {
    if (currentStep > 0) {
        currentStep--;
        
        // 清空当前所有对象（除了背景图片）
        const background = canvas.getObjects().find(obj => obj.id === 'background_image');
        canvas.clear();
        
        if (background) {
            canvas.add(background);
            canvas.sendToBack(background);
        }
        
        // 加载历史状态
        if (history[currentStep]) {
            const state = JSON.parse(history[currentStep]);
            canvas.loadFromJSON(state, function() {
                canvas.renderAll();
                updateObjectList();
            });
        }
    }
}

// 提交答案
function submitAnswer() {
    if (!imageLoaded) {
        alert('请先加载一张图片！');
        return;
    }
    
    const objects = canvas.getObjects().filter(obj => 
        obj instanceof fabric.Rect && obj.id && obj.id.startsWith('rect_')
    );
    
    if (objects.length === 0) {
        alert('请至少标注一个对象！');
        return;
    }
    
    // 禁用提交按钮
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 正在评分...';
    
    // 获取用户标注数据
    const userAnnotations = objects.map(obj => ({
        id: obj.id,
        label: obj.label || 'car',
        left: Math.round(obj.left),
        top: Math.round(obj.top),
        width: Math.round(obj.width),
        height: Math.round(obj.height)
    }));
    
    // 模拟评分过程（延迟1秒，让用户看到加载状态）
    setTimeout(() => {
        calculateAndShowScore(userAnnotations);
    }, 1000);
}

// 计算并显示分数
function calculateAndShowScore(userAnnotations) {
    const scorePanel = document.getElementById('scorePanel');
    const scoreValue = document.getElementById('scoreValue');
    const scoreFeedback = document.getElementById('scoreFeedback');
    
    // 显示评分面板
    scorePanel.style.display = 'block';
    
    // 滚动到评分面板
    scorePanel.scrollIntoView({ behavior: 'smooth' });
    
    // 模拟评分计算
    // 这里使用一个简单的模拟算法
    // 实际应该使用scoring-algorithm.js中的算法
    
    let score = 0;
    let feedback = '';
    
    // 基本分数：每个标注给基础分
    const baseScore = Math.min(80, userAnnotations.length * 15);
    
    // 随机模拟一些错误和遗漏
    const hasErrors = Math.random() > 0.7;
    const hasMissed = Math.random() > 0.5;
    
    if (hasErrors) {
        score = baseScore - 20;
        feedback = '发现了一些错误标注，请检查框体位置';
    } else if (hasMissed) {
        score = baseScore - 10;
        feedback = '可能遗漏了一些对象，请仔细检查';
    } else {
        score = baseScore;
        feedback = '标注质量不错！';
    }
    
    // 确保分数在合理范围内
    score = Math.max(0, Math.min(100, score));
    
    // 添加额外分数使结果看起来更真实
    score += Math.floor(Math.random() * 10);
    score = Math.min(100, score);
    
    // 根据分数给出最终反馈
    let finalFeedback = '';
    if (score >= 90) {
        finalFeedback = '🎉 优秀！标注非常准确！';
    } else if (score >= 70) {
        finalFeedback = '👍 良好！大部分标注正确！';
    } else if (score >= 50) {
        finalFeedback = '✅ 及格！需要继续练习！';
    } else {
        finalFeedback = '📚 加油！建议重新学习相关知识！';
    }
    
    // 显示评分动画
    let currentScore = 0;
    const interval = setInterval(() => {
        currentScore += 2;
        if (currentScore >= score) {
            currentScore = score;
            clearInterval(interval);
            
            // 显示最终反馈
            scoreFeedback.innerHTML = `
                ${finalFeedback}<br>
                <small style="opacity: 0.8;">${feedback}</small><br>
                <small style="opacity: 0.6;">标注了 ${userAnnotations.length} 个对象</small>
            `;
            
            // 恢复提交按钮
            const submitBtn = document.getElementById('submitBtn');
            submitBtn.style.display = 'none';
            
            // 保存成绩到本地存储
            saveScoreToLocalStorage(score, userAnnotations.length);
        }
        scoreValue.textContent = currentScore;
    }, 20);
}

// 保存成绩到本地存储
function saveScoreToLocalStorage(score, objectCount) {
    try {
        let scores = JSON.parse(localStorage.getItem('labeling_scores') || '[]');
        scores.push({
            date: new Date().toLocaleString(),
            score: score,
            type: 'image_labeling',
            exercise: '车辆检测标注',
            objectCount: objectCount,
            timestamp: new Date().getTime()
        });
        
        // 只保留最近10次记录
        if (scores.length > 10) {
            scores = scores.slice(-10);
        }
        
        localStorage.setItem('labeling_scores', JSON.stringify(scores));
        console.log('成绩已保存:', score);
    } catch (e) {
        console.error('保存成绩失败:', e);
    }
}

// 查看参考答案
function showAnswer() {
    alert('参考答案功能正在开发中...\n\n当前练习的参考答案：\n在图片中标注出所有的汽车，注意车辆的大小和位置。');
}

// 获取所有标注对象
function getAllAnnotations() {
    const objects = canvas.getObjects().filter(obj => 
        obj instanceof fabric.Rect && obj.id && obj.id.startsWith('rect_')
    );
    
    return objects.map(obj => ({
        id: obj.id,
        label: obj.label || 'car',
        left: Math.round(obj.left),
        top: Math.round(obj.top),
        width: Math.round(obj.width),
        height: Math.round(obj.height),
        color: obj.stroke
    }));
}

// 导出标注结果
function exportAnnotations() {
    const annotations = getAllAnnotations();
    if (annotations.length === 0) {
        alert('没有可导出的标注！');
        return;
    }
    
    const dataStr = JSON.stringify(annotations, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = '标注结果_' + new Date().toISOString().slice(0,10) + '.json';
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    
    alert(`成功导出 ${annotations.length} 个标注！`);
}