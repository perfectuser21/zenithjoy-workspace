// 云函数入口文件
const cloud = require("wx-server-sdk")

// 初始化云环境
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 获取数据库引用
const db = cloud.database()

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const appid = wxContext.APPID
  
  console.log('开始初始化数据库...')
  
  try {
    // 初始化必要的集合
    await initCollections()
    
    // 创建管理员集合
    await createCollectionIfNotExists('admins')
    
    // 创建聊天记录集合
    await createCollectionIfNotExists('chats')
    
    // 创建会员集合
    await createCollectionIfNotExists('memberships')
    
    // 创建会员套餐集合
    await createCollectionIfNotExists('membership_plans')
    
    // 创建订单集合
    await createCollectionIfNotExists('orders')
    
    // 创建用户集合
    await createCollectionIfNotExists('users')
    
    // 添加默认会员套餐
    await initDefaultMembershipPlans()
    
    // 初始化默认管理员
    await initDefaultAdmin(openid)

    return {
      success: true,
      message: '数据库初始化成功',
      openid,
      appid
    }
  } catch (error) {
    console.error('初始化数据库失败:', error)
    return {
      success: false,
      error: error,
      openid,
      appid
    }
  }
}

// 创建必要的集合
async function initCollections() {
  const collections = [
    'users',        // 用户集合
    'messages',     // 消息集合
    'chats',        // 聊天历史集合
    'conversations' // 会话集合
  ]
  
  for (let coll of collections) {
    try {
      await db.createCollection(coll)
      console.log(`创建集合成功: ${coll}`)
    } catch (e) {
      // 如果集合已存在，会抛出错误，我们可以忽略这个错误
      console.log(`集合已存在或创建失败: ${coll}`, e.message || e)
    }
  }
}

// 如果集合不存在则创建
async function createCollectionIfNotExists(collectionName) {
  try {
    await db.createCollection(collectionName)
    console.log(`创建集合成功: ${collectionName}`)
    return true
  } catch (err) {
    // 如果集合已存在，则会抛出错误，但这不是实际的错误
    console.log(`集合已存在或创建失败: ${collectionName}`, err)
    return false
  }
}

// 初始化默认会员套餐
async function initDefaultMembershipPlans() {
  const _ = db.command
  const plans = [
    {
      id: 'free',
      name: '普通会员',
      price: 0,
      originalPrice: 0,
      duration: 0, // 永久
      benefits: [
        '每日AI对话次数限制',
        '基础生成功能',
        '普通优先级',
      ],
      dailyQuota: 10, // 每日对话次数限制
      isDefault: true,
      status: 'active',
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    },
    {
      id: 'standard',
      name: '尊享会员',
      price: 30,
      originalPrice: 50,
      duration: 30, // 30天
      benefits: [
        '大幅提升AI对话次数限制',
        '高级生成功能',
        '提高优先级',
        '使用高级AI模型'
      ],
      dailyQuota: 50, // 每日对话次数限制
      isDefault: false,
      status: 'active',
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    },
    {
      id: 'premium',
      name: '超级会员',
      price: 98,
      originalPrice: 198,
      duration: 90, // 90天
      benefits: [
        '无限AI对话次数',
        '全部高级生成功能',
        '最高优先级',
        '独享专属客服',
        '使用最新AI模型'
      ],
      dailyQuota: -1, // 无限制
      isDefault: false,
      status: 'active',
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }
  ]
  
  // 检查是否已存在套餐，不存在则添加
  for (const plan of plans) {
    const exists = await db.collection('membership_plans')
      .where({
        id: plan.id
      })
      .get()
    
    if (exists.data.length === 0) {
      await db.collection('membership_plans').add({
        data: plan
      })
      console.log(`添加默认套餐成功: ${plan.name}`)
    } else {
      // 更新现有套餐
      await db.collection('membership_plans')
        .where({
          id: plan.id
        })
        .update({
          data: {
            name: plan.name,
            price: plan.price,
            originalPrice: plan.originalPrice,
            duration: plan.duration,
            benefits: plan.benefits,
            dailyQuota: plan.dailyQuota,
            status: plan.status,
            updatedAt: db.serverDate()
          }
        })
      console.log(`更新默认套餐成功: ${plan.name}`)
    }
  }
}

// 检查集合是否存在
async function checkCollectionExists(collectionName) {
  try {
    // 尝试查询集合中的文档数量
    await db.collection(collectionName).limit(1).get()
    return true
  } catch (error) {
    if (error.errCode === -502005) {
      // 集合不存在
      return false
    }
    throw error // 其他错误重新抛出
  }
}

// 初始化默认管理员
async function initDefaultAdmin(currentUserOpenid) {
  try {
    // 检查当前用户是否已经是管理员
    const adminExists = await db.collection('admins').where({
      openId: currentUserOpenid
    }).get()
    
    // 如果当前用户不是管理员，则添加为管理员
    if (adminExists.data.length === 0) {
      await db.collection('admins').add({
        data: {
          openId: currentUserOpenid,
          role: 'superadmin',
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
          remark: '初始化时自动创建的超级管理员'
        }
      })
      console.log(`已将当前用户(${currentUserOpenid})设置为超级管理员`)
    } else {
      console.log(`当前用户(${currentUserOpenid})已经是管理员`)
    }
    
    return true
  } catch (err) {
    console.error('初始化管理员失败', err)
    return false
  }
} 