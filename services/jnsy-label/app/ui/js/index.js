// 简单的交互功能
document.addEventListener('DOMContentLoaded', function() {
    console.log('AI训练师门户页加载完成');
    
    // 用户下拉菜单功能（增强交互）
    const userProfile = document.querySelector('.user-profile');
    const dropdownMenu = document.querySelector('.dropdown-menu');
    
    // 点击用户区域显示/隐藏下拉菜单
    userProfile.addEventListener('click', function(e) {
        e.stopPropagation();
        const isVisible = dropdownMenu.style.opacity === '1';
        
        if (isVisible) {
            dropdownMenu.style.opacity = '0';
            dropdownMenu.style.visibility = 'hidden';
            dropdownMenu.style.transform = 'translateY(-10px)';
        } else {
            dropdownMenu.style.opacity = '1';
            dropdownMenu.style.visibility = 'visible';
            dropdownMenu.style.transform = 'translateY(0)';
        }
    });
    
    // 点击页面其他地方关闭下拉菜单
    document.addEventListener('click', function() {
        dropdownMenu.style.opacity = '0';
        dropdownMenu.style.visibility = 'hidden';
        dropdownMenu.style.transform = 'translateY(-10px)';
    });
    
    // 阻止下拉菜单内的点击事件冒泡
    dropdownMenu.addEventListener('click', function(e) {
        e.stopPropagation();
    });
    
    // 通知按钮点击效果
    const notificationBtn = document.querySelector('.btn-notification');
    notificationBtn.addEventListener('click', function() {
        // 模拟清除通知
        const badge = this.querySelector('.notification-badge');
        badge.style.transform = 'scale(0)';
        setTimeout(() => {
            badge.style.display = 'none';
            // 这里可以添加实际的通知逻辑
            alert('通知功能将在后续版本中完善');
        }, 300);
    });
    
    // 卡片悬停效果增强
    const cards = document.querySelectorAll('.module-card');
    cards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-8px)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
        });
    });
    
    // 动态更新欢迎消息（基于时间）
    const welcomeTitle = document.querySelector('.welcome-section h1');
    const hour = new Date().getHours();
    let greeting = '';
    
    if (hour < 12) greeting = '早上好';
    else if (hour < 18) greeting = '下午好';
    else greeting = '晚上好';
    
    // 保持原有内容，只在前面加上时间问候
    const originalText = welcomeTitle.innerHTML;
    welcomeTitle.innerHTML = `<span style="font-weight: 300;">${greeting}，</span>${originalText}`;
});