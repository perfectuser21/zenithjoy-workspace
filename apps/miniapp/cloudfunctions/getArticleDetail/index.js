// 云函数入口文件
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

// 云函数入口函数
exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext();
  
  // 返回空数据，不再获取任何文章详情
  return {
    success: false,
    data: null,
    message: "文章功能已禁用"
  };
};

// 格式化日期函数
function formatDate(dateTime) {
  if (!dateTime) return '';
  
  const date = new Date(dateTime);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
} 