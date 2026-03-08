// login.js - 学员端登录页逻辑（只负责登录，不显示激活入口）
(function () {
  const form = document.getElementById("loginForm");
  const msg = document.getElementById("loginMsg");

  function setMsg(text, type = "info") {
    msg.textContent = text || "";
    msg.className = "msg " + type;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const phone = document.getElementById("phone").value.trim();
    const password = document.getElementById("password").value;

    if (!phone || !password) {
      setMsg("请填写手机号和密码。", "warn");
      return;
    }

    setMsg("登录中…", "info");

    try {
      const res = await fetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, password }),
      });

      if (!res.ok) {
        const t = await res.text();
        // 常见：401 账号未激活/密码错误
        setMsg(`登录失败：${res.status} ${t}`, "error");
        return;
      }

      const data = await res.json();
      const token = data.access_token;
      if (!token) {
        setMsg("登录失败：未获取到 access_token", "error");
        return;
      }

      localStorage.setItem("access_token", token);
      localStorage.setItem("phone", phone);

      setMsg("登录成功，正在进入训练…", "ok");
      // 跳到训练页（下一步我们再美化训练页/文本标注页）
      window.location.href = "/ui/index.html";
    } catch (err) {
      setMsg("网络错误：请确认后端已启动，稍后再试。", "error");
      console.error(err);
    }
  });
})();
