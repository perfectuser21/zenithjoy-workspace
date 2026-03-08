// js/scoring-algorithm.js
// 图片标注评分算法

class ScoringAlgorithm {
    // 标准答案数据（示例）
    static correctAnswers = {
        // 示例1：车辆检测
        'vehicle_detection': [
            { id: 1, label: 'car', left: 120, top: 180, width: 150, height: 80 },
            { id: 2, label: 'car', left: 320, top: 200, width: 140, height: 75 },
            { id: 3, label: 'car', left: 550, top: 190, width: 160, height: 85 }
        ],
        
        // 示例2：行人检测
        'pedestrian_detection': [
            { id: 1, label: 'person', left: 200, top: 250, width: 40, height: 100 },
            { id: 2, label: 'person', left: 400, top: 230, width: 35, height: 95 },
            { id: 3, label: 'person', left: 600, top: 240, width: 45, height: 105 }
        ]
    };
    
    // 对比用户标注与标准答案
    static compareAnnotations(userRects, exerciseType = 'vehicle_detection') {
        const correctRects = this.correctAnswers[exerciseType] || [];
        
        if (correctRects.length === 0) {
            return {
                score: 0,
                feedback: ['暂无标准答案数据'],
                details: {
                    userRects: userRects.length,
                    correctRects: 0,
                    matched: 0,
                    missed: 0
                }
            };
        }
        
        let totalScore = 0;
        let feedback = [];
        let matchedCorrectIndices = new Set();
        let matchedUserIndices = new Set();
        
        // 第一轮：匹配用户标注到正确答案
        userRects.forEach((userRect, userIndex) => {
            let bestMatchIndex = -1;
            let bestIoU = 0;
            
            correctRects.forEach((correctRect, correctIndex) => {
                // 跳过已经匹配的正确答案
                if (matchedCorrectIndices.has(correctIndex)) return;
                
                const iou = this.calculateIoU(userRect, correctRect);
                if (iou > bestIoU) {
                    bestIoU = iou;
                    bestMatchIndex = correctIndex;
                }
            });
            
            if (bestIoU > 0.5 && bestMatchIndex !== -1) {
                // 正确标注：IoU > 0.5
                totalScore += 25;
                matchedCorrectIndices.add(bestMatchIndex);
                matchedUserIndices.add(userIndex);
                feedback.push(`✅ 标注 ${userIndex + 1}: 正确 (IoU: ${bestIoU.toFixed(2)})`);
            } else if (bestIoU > 0.3 && bestMatchIndex !== -1) {
                // 部分正确：0.3 < IoU <= 0.5
                totalScore += 10;
                matchedCorrectIndices.add(bestMatchIndex);
                matchedUserIndices.add(userIndex);
                feedback.push(`⚠️ 标注 ${userIndex + 1}: 部分正确 (IoU: ${bestIoU.toFixed(2)})`);
            } else {
                // 错误标注：IoU <= 0.3 或没有匹配
                totalScore -= 15;
                feedback.push(`❌ 标注 ${userIndex + 1}: 错误或无匹配对象`);
            }
        });
        
        // 第二轮：检查遗漏的正确答案
        const missedCount = correctRects.length - matchedCorrectIndices.size;
        if (missedCount > 0) {
            const penalty = missedCount * 15;
            totalScore = Math.max(0, totalScore - penalty);
            feedback.push(`⏰ 遗漏了 ${missedCount} 个对象`);
        }
        
        // 第三轮：检查额外标注（标注了不存在的东西）
        const extraCount = userRects.length - matchedUserIndices.size;
        if (extraCount > 0) {
            feedback.push(`➕ 有 ${extraCount} 个额外标注`);
        }
        
        // 确保分数在0-100之间
        totalScore = Math.max(0, Math.min(100, totalScore));
        
        // 添加质量评分
        const qualityBonus = this.calculateQualityBonus(userRects);
        totalScore += qualityBonus;
        totalScore = Math.min(100, totalScore);
        
        return {
            score: Math.round(totalScore),
            feedback: feedback,
            details: {
                userRects: userRects.length,
                correctRects: correctRects.length,
                matched: matchedCorrectIndices.size,
                missed: missedCount,
                extra: extraCount,
                qualityBonus: qualityBonus
            }
        };
    }
    
    // 计算两个矩形的交并比（IoU）
    static calculateIoU(rect1, rect2) {
        // 确保rect1和rect2都有必要的属性
        if (!rect1 || !rect2 || !rect1.left || !rect2.left) {
            return 0;
        }
        
        const x1 = Math.max(rect1.left, rect2.left);
        const y1 = Math.max(rect1.top, rect2.top);
        const x2 = Math.min(rect1.left + rect1.width, rect2.left + rect2.width);
        const y2 = Math.min(rect1.top + rect1.height, rect2.top + rect2.height);
        
        // 检查是否有交集
        if (x2 < x1 || y2 < y1) {
            return 0;
        }
        
        // 计算交集面积
        const intersection = (x2 - x1) * (y2 - y1);
        
        // 计算各自的面积
        const area1 = rect1.width * rect1.height;
        const area2 = rect2.width * rect2.height;
        
        // 计算并集面积
        const union = area1 + area2 - intersection;
        
        // 避免除以零
        if (union === 0) return 0;
        
        return intersection / union;
    }
    
    // 计算标注质量奖励
    static calculateQualityBonus(rects) {
        if (rects.length === 0) return 0;
        
        let bonus = 0;
        
        // 检查标注的整齐度
        rects.forEach(rect => {
            // 宽高比例合理的奖励
            const aspectRatio = rect.width / rect.height;
            if (aspectRatio > 0.5 && aspectRatio < 2.0) {
                bonus += 2;
            }
            
            // 大小适中的奖励（避免太大或太小的标注）
            const area = rect.width * rect.height;
            if (area > 500 && area < 20000) {
                bonus += 2;
            }
        });
        
        // 标注数量适当的奖励
        if (rects.length >= 2 && rects.length <= 10) {
            bonus += 5;
        }
        
        return Math.min(15, bonus); // 最多15分奖励
    }
    
    // 获取评分说明
    static getScoringExplanation() {
        return {
            perfectMatch: 'IoU > 0.7: 25分',
            goodMatch: '0.5 < IoU ≤ 0.7: 20分',
            fairMatch: '0.3 < IoU ≤ 0.5: 10分',
            poorMatch: 'IoU ≤ 0.3: 0分',
            wrongLabel: '标签错误: -10分',
            missedObject: '遗漏对象: -15分',
            extraObject: '额外标注: -5分',
            qualityBonus: '标注质量奖励: 最多+15分'
        };
    }
    
    // 生成详细评分报告
    static generateDetailedReport(userRects, exerciseType) {
        const result = this.compareAnnotations(userRects, exerciseType);
        
        const report = {
            summary: {
                score: result.score,
                grade: this.getGrade(result.score),
                timestamp: new Date().toLocaleString()
            },
            statistics: result.details,
            feedback: result.feedback,
            suggestions: this.getImprovementSuggestions(result)
        };
        
        return report;
    }
    
    // 根据分数获取等级
    static getGrade(score) {
        if (score >= 90) return 'A+ (优秀)';
        if (score >= 80) return 'A (良好)';
        if (score >= 70) return 'B (中等)';
        if (score >= 60) return 'C (及格)';
        return 'D (不及格)';
    }
    
    // 获取改进建议
    static getImprovementSuggestions(result) {
        const suggestions = [];
        
        if (result.details.missed > 0) {
            suggestions.push('仔细观察图片，不要遗漏对象');
        }
        
        if (result.details.extra > 0) {
            suggestions.push('只标注要求的目标，避免标注无关对象');
        }
        
        if (result.feedback.some(f => f.includes('部分正确'))) {
            suggestions.push('调整框体位置，使其更紧密地贴合目标边缘');
        }
        
        if (result.score < 60) {
            suggestions.push('建议重新学习标注基础知识');
        } else if (result.score < 80) {
            suggestions.push('继续练习，提高标注准确度');
        } else {
            suggestions.push('保持良好表现！');
        }
        
        return suggestions;
    }
}