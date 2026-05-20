// js/auth.js - 统一的登录状态管理

// 登录状态键名
const AUTH_KEYS = {
    IS_LOGGED_IN: 'isLoggedIn',
    USER_DATA: 'user',
    LOGIN_TIME: 'loginTime',
    USER_ROLE: 'userRole'
};

// 登录函数（在login.html中使用）
function loginUser(userData) {
    try {
        // 保存用户数据
        localStorage.setItem(AUTH_KEYS.USER_DATA, JSON.stringify(userData));
        localStorage.setItem(AUTH_KEYS.IS_LOGGED_IN, 'true');
        localStorage.setItem(AUTH_KEYS.LOGIN_TIME, new Date().toISOString());
        localStorage.setItem(AUTH_KEYS.USER_ROLE, userData.role || 'student');
        
        console.log('用户登录成功:', userData.username);
        return true;
    } catch (error) {
        console.error('登录状态保存失败:', error);
        return false;
    }
}

// 注销函数
function logoutUser() {
    try {
        localStorage.removeItem(AUTH_KEYS.USER_DATA);
        localStorage.removeItem(AUTH_KEYS.IS_LOGGED_IN);
        localStorage.removeItem(AUTH_KEYS.LOGIN_TIME);
        localStorage.removeItem(AUTH_KEYS.USER_ROLE);
        console.log('用户已注销');
        return true;
    } catch (error) {
        console.error('注销失败:', error);
        return false;
    }
}

// 检查登录状态（在所有页面中使用）
function checkLoginStatus() {
    try {
        const isLoggedIn = localStorage.getItem(AUTH_KEYS.IS_LOGGED_IN);
        const userData = JSON.parse(localStorage.getItem(AUTH_KEYS.USER_DATA) || 'null');
        const loginTime = localStorage.getItem(AUTH_KEYS.LOGIN_TIME);
        
        // 检查基本条件
        if (isLoggedIn !== 'true' || !userData) {
            return { isLoggedIn: false, user: null };
        }
        
        // 可选：检查登录是否过期（24小时）
        if (loginTime) {
            const loginDate = new Date(loginTime);
            const now = new Date();
            const hoursDiff = (now - loginDate) / (1000 * 60 * 60);
            
            if (hoursDiff > 24) {
                console.log('登录已过期，自动注销');
                logoutUser();
                return { isLoggedIn: false, user: null };
            }
        }
        
        return {
            isLoggedIn: true,
            user: userData,
            role: userData.role || 'student'
        };
    } catch (error) {
        console.error('检查登录状态失败:', error);
        return { isLoggedIn: false, user: null };
    }
}

// 获取当前用户
function getCurrentUser() {
    const status = checkLoginStatus();
    return status.isLoggedIn ? status.user : null;
}

// 检查并重定向（如果未登录）
function requireLogin(redirectUrl = 'login.html') {
    const status = checkLoginStatus();
    if (!status.isLoggedIn) {
        window.location.href = redirectUrl;
        return false;
    }
    return status.user;
}

// 检查特定角色
function requireRole(requiredRole, redirectUrl = 'login.html') {
    const status = checkLoginStatus();
    if (!status.isLoggedIn || status.role !== requiredRole) {
        window.location.href = redirectUrl;
        return false;
    }
    return status.user;
}

// 暴露函数到全局
window.auth = {
    login: loginUser,
    logout: logoutUser,
    check: checkLoginStatus,
    getUser: getCurrentUser,
    requireLogin: requireLogin,
    requireRole: requireRole
};