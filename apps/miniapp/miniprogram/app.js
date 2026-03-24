// app.js
App({
  onLaunch() {
    // 初始化云环境
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
    } else {
      wx.cloud.init({
        // env 参数说明：
        //   env 参数决定接下来小程序发起的云开发调用会默认请求到哪个云环境的资源
        //   此处请填入环境 ID, 环境 ID 可打开云控制台查看
        //   如不填则使用默认环境（第一个创建的环境）
        env: 'zenithjoycloud-8g4ca5pbb5b027e8',
        traceUser: true,
      })
    }
    
    // 自动初始化数据库
    this.initDatabaseCollections();

    // 添加网络请求白名单（仅在开发环境中有效）
    this.setRequestDomains();
    
    this.globalData = {
      userInfo: null,
      hasUserInfo: false,
      hasLogin: false,
      env: wx.getAccountInfoSync().miniProgram.envVersion || 'release' // 获取当前环境
    };
    
    // 监听错误
    wx.onError((error) => {
      console.error('全局错误:', error);
    });
  },
  
  // 设置请求域名白名单（开发环境使用）
  setRequestDomains() {
    // 开发环境
    const envVersion = wx.getAccountInfoSync().miniProgram.envVersion;
    if (envVersion === 'develop') {
      console.log('开发环境，扩展网络请求白名单');
      wx.setRequestDomains && wx.setRequestDomains({
        requestDomains: [
          'https://api.coze.cn',
          'https://servicewechat.com'
        ],
        success(res) {
          console.log('设置请求域名白名单成功', res)
        },
        fail(err) {
          console.error('设置请求域名白名单失败', err)
        }
      });
    }
  },
  
  // 初始化数据库集合
  initDatabaseCollections() {
    console.log('开始初始化数据库...')
    wx.cloud.callFunction({
      name: 'initDatabase',
      success: (res) => {
        console.log('数据库初始化成功:', res.result)
        if (res.result && res.result.result) {
          const dbResult = res.result.result;
          
          // 检查是否有错误
          if (dbResult.errors && dbResult.errors.length > 0) {
            console.warn('数据库初始化有部分错误:', dbResult.errors)
          }
          
          // 显示初始化结果
          const createdCollections = dbResult.collections.filter(c => c.created).map(c => c.name);
          if (createdCollections.length > 0) {
            console.log('新创建的集合:', createdCollections.join(', '))
          }
        }
      },
      fail: (err) => {
        console.error('数据库初始化失败:', err)
        // 在错误严重时通知用户
        if (err.errCode !== -404) { // 忽略函数不存在的错误
          wx.showToast({
            title: '数据库初始化失败',
            icon: 'none'
          })
        }
      }
    })
  },
  
  // 全局错误处理
  onError(err) {
    // 处理全局错误
    console.error('应用发生错误:', err);
  },
  
  // 页面找不到处理
  onPageNotFound(res) {
    // 页面不存在时重定向到首页
    wx.reLaunch({
      url: '/pages/index/index'
    });
    console.error('页面不存在:', res.path);
  }
}) 