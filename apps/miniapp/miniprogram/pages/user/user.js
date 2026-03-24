// 我的页面
const app = getApp()
const db = wx.cloud.database()

Page({

  /**
   * 页面的初始数据
   */
  data: {
    userInfo: {},
    hasUserInfo: false,
    canIUseGetUserProfile: false,
    isAdmin: false,
    phoneNumber: '', // 添加用户手机号
    membership: {
      level: 'free', // 默认是免费会员
      name: '普通会员',
      expireDate: null
    }
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    if (wx.getUserProfile) {
      this.setData({
        canIUseGetUserProfile: true
      })
    }
    
    // 检查用户登录状态
    this.checkUserInfo()
    
    // 检查管理员状态
    this.checkAdminStatus()
  },

  /**
   * 生命周期函数--监听页面初次渲染完成
   */
  onReady() {

  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    // 每次页面显示时检查会员状态
    if (this.data.hasUserInfo) {
      this.checkMembershipStatus()
    }
  },

  /**
   * 生命周期函数--监听页面隐藏
   */
  onHide() {

  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {

  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    // 下拉刷新用户信息和会员状态
    if (this.data.hasUserInfo) {
      Promise.all([
        this.checkUserInfo(),
        this.checkAdminStatus(),
        this.checkMembershipStatus()
      ]).then(() => {
        wx.stopPullDownRefresh()
      })
    } else {
      wx.stopPullDownRefresh()
    }
  },

  /**
   * 页面上拉触底事件的处理函数
   */
  onReachBottom() {

  },

  /**
   * 用户点击右上角分享
   */
  onShareAppMessage() {

  },

  // 检查用户信息
  checkUserInfo() {
    return new Promise((resolve, reject) => {
      const userInfo = wx.getStorageSync('userInfo')
      if (userInfo) {
        this.setData({
          userInfo: userInfo,
          hasUserInfo: true
        })
        
        // 检查是否有手机号
        wx.cloud.callFunction({
          name: 'login',
          success: res => {
            const openid = res.result.openid
            
            // 查询用户的信息
            db.collection('users').where({
              _openid: openid
            }).get().then(userRes => {
              if (userRes.data.length > 0 && userRes.data[0].phoneNumber) {
                this.setData({
                  phoneNumber: userRes.data[0].phoneNumber
                })
              }
              resolve()
            }).catch(err => {
              console.error('获取用户手机号失败', err)
              resolve()
            })
          },
          fail: err => {
            console.error('登录失败', err)
            resolve()
          }
        })
      } else {
        this.setData({
          hasUserInfo: false
        })
        resolve()
      }
    })
  },
  
  // 开始登录流程
  startLogin() {
    this.getUserProfile()
  },
  
  // 获取用户信息
  getUserProfile() {
    wx.showLoading({
      title: '正在登录',
    })
    
    wx.getUserProfile({
      desc: '用于完善用户资料',
      success: (res) => {
        // 保存用户信息到本地存储
        wx.setStorageSync('userInfo', res.userInfo)
        
        // 更新数据
        this.setData({
          userInfo: res.userInfo,
          hasUserInfo: true
        })
        
        // 保存用户信息到云数据库
        this.saveUserProfile(res.userInfo)
        
        // 检查会员状态
        this.checkMembershipStatus().then(() => {
          // 登录成功后立即触发手机号获取流程
          wx.hideLoading()
          
          // 如果用户已经有手机号，则不再请求
          if (!this.data.phoneNumber) {
            setTimeout(() => {
              this.triggerPhoneNumberRequest()
            }, 500) // 延迟一下，让页面渲染完成
          }
        })
      },
      fail: (err) => {
        console.error('获取用户信息失败', err)
        wx.hideLoading()
        wx.showToast({
          title: '登录已取消',
          icon: 'none'
        })
      }
    })
  },
  
  // 触发手机号获取请求
  triggerPhoneNumberRequest() {
    // 直接触发手机号获取按钮，无需确认对话框
    setTimeout(() => {
      const phoneBtn = wx.createSelectorQuery().select('#phoneBtn')
      phoneBtn.node(res => {
        if (res && res.node) {
          try {
            const tapEvent = {type: 'tap', target: {id: 'phoneBtn'}}
            res.node.dispatchEvent(tapEvent)
          } catch (err) {
            console.error('触发手机号按钮失败:', err)
            // 如果自动点击失败，使用原生方式模拟点击
            wx.showToast({
              title: '请点击授权手机号按钮完成登录',
              icon: 'none',
              duration: 3000
            })
          }
        } else {
          console.log('未找到手机号按钮节点')
          // 修改提示文案
          wx.showToast({
            title: '请尝试重新登录并授权手机号',
            icon: 'none',
            duration: 2000
          })
        }
      }).exec()
    }, 300) // 短暂延迟，确保UI已更新
  },
  
  // 保存用户资料到云数据库
  saveUserProfile(userInfo) {
    wx.cloud.callFunction({
      name: 'login',
      success: res => {
        const openid = res.result.openid
        
        // 查询用户是否已存在
        db.collection('users').where({
          _openid: openid
        }).get().then(res => {
          if (res.data.length === 0) {
            // 如果用户不存在，创建新用户记录
            db.collection('users').add({
              data: {
                ...userInfo,
                createdAt: db.serverDate(),
                updatedAt: db.serverDate(),
                membership: {
                  level: 'free',
                  name: '普通会员',
                  expireDate: null
                }
              }
            })
          } else {
            // 如果用户存在，更新用户信息
            db.collection('users').doc(res.data[0]._id).update({
              data: {
                ...userInfo,
                updatedAt: db.serverDate()
              }
            })
          }
        })
      },
      fail: err => {
        console.error('登录失败', err)
      }
    })
  },
  
  // 检查管理员状态
  checkAdminStatus() {
    return new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: 'checkAdmin',
        success: res => {
          this.setData({
            isAdmin: res.result && res.result.isAdmin
          })
          resolve(res.result && res.result.isAdmin)
        },
        fail: err => {
          console.error('检查管理员权限失败', err)
          // 失败时默认设置为非管理员
          this.setData({
            isAdmin: false
          })
          // 即使失败也返回resolved状态，不中断程序流程
          resolve(false)
        }
      })
    })
  },
  
  // 检查会员状态
  checkMembershipStatus() {
    return new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: 'login',
        success: res => {
          const openid = res.result.openid
          
          // 查询用户的会员信息
          db.collection('users').where({
            _openid: openid
          }).get().then(res => {
            if (res.data.length > 0 && res.data[0].membership) {
              const membership = res.data[0].membership
              
              // 检查会员是否过期
              if (membership.level !== 'free' && membership.expireDate) {
                const expireDate = new Date(membership.expireDate)
                const now = new Date()
                
                // 如果已过期，降级为免费会员
                if (now > expireDate) {
                  this.setData({
                    membership: {
                      level: 'free',
                      name: '普通会员',
                      expireDate: null
                    }
                  })
                  
                  // 更新数据库中的会员状态
                  db.collection('users').doc(res.data[0]._id).update({
                    data: {
                      membership: {
                        level: 'free',
                        name: '普通会员',
                        expireDate: null
                      }
                    }
                  })
                } else {
                  // 会员未过期
                  this.setData({
                    membership: membership
                  })
                }
              } else {
                // 用户是免费会员或没有过期日期
                this.setData({
                  membership: membership
                })
              }
            } else {
              // 用户不存在或没有会员信息，设置为免费会员
              this.setData({
                membership: {
                  level: 'free',
                  name: '普通会员',
                  expireDate: null
                }
              })
            }
            resolve()
          }).catch(err => {
            console.error('获取会员信息失败', err)
            resolve()
          })
        },
        fail: err => {
          console.error('登录失败', err)
          resolve()
        }
      })
    })
  },
  
  // 导航到会员中心
  navigateToMembership() {
    if (!this.data.hasUserInfo) {
      wx.showToast({
        title: '请先登录',
        icon: 'none'
      })
      return
    }
    
    wx.navigateTo({
      url: '/pages/membership/membership'
    })
  },
  
  // 导航到管理员页面
  navigateToAdmin() {
    wx.navigateTo({
      url: '/pages/admin/index'
    })
  },
  
  // 导航到聊天记录
  navigateToChatHistory() {
    if (!this.data.hasUserInfo) {
      wx.showToast({
        title: '请先登录',
        icon: 'none'
      })
      return
    }
    
    wx.navigateTo({
      url: '/pages/chatHistory/index'
    })
  },
  
  // 清除缓存
  clearCache() {
    wx.showModal({
      title: '提示',
      content: '确定要清除缓存吗？这将清除本地保存的用户信息和聊天记录',
      success: (res) => {
        if (res.confirm) {
          // 清除本地存储
          wx.clearStorageSync()
          
          // 重置数据
          this.setData({
            userInfo: {},
            hasUserInfo: false,
            membership: {
              level: 'free',
              name: '普通会员',
              expireDate: null
            }
          })
          
          wx.showToast({
            title: '缓存已清除',
            icon: 'success'
          })
        }
      }
    })
  },

  // 获取用户手机号
  getPhoneNumber(e) {
    console.log('获取手机号结果:', e.detail);
    
    if (e.detail.errMsg === 'getPhoneNumber:ok') {
      const cloudID = e.detail.cloudID; // 新版本微信支持cloudID直接获取手机号
      
      wx.showLoading({
        title: '正在验证手机号',
      });
      
      // 调用云函数解析手机号
      wx.cloud.callFunction({
        name: 'getPhoneNumber',
        data: {
          cloudID: cloudID
        },
        success: res => {
          console.log('手机号获取成功:', res);
          
          if (res.result && res.result.success) {
            // 获取云函数返回的手机号
            const phoneNumber = res.result.phoneNumber;
            
            if (phoneNumber) {
              this.setData({
                phoneNumber: phoneNumber
              });
              
              // 完整登录流程成功提示
              wx.hideLoading();
              wx.showToast({
                title: '登录完成',
                icon: 'success',
                duration: 2000
              });
            } else {
              wx.hideLoading();
              wx.showToast({
                title: '未获取到手机号',
                icon: 'none',
                duration: 2000
              });
            }
          } else {
            wx.hideLoading();
            wx.showToast({
              title: res.result && res.result.message || '手机号获取失败',
              icon: 'none',
              duration: 2000
            });
          }
        },
        fail: err => {
          console.error('调用云函数获取手机号失败', err);
          wx.hideLoading();
          wx.showToast({
            title: '手机号获取失败',
            icon: 'none',
            duration: 2000
          });
        }
      });
    } else {
      // 用户拒绝授权
      wx.showToast({
        title: '您已取消手机号授权',
        icon: 'none',
        duration: 2000
      });
    }
  }
})