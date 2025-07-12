// 内容脚本，在支持的平台上注入下载拦截功能

// 平台检测和 URL 转换
const PLATFORMS = {
  gh: {
    base: "https://github.com",
    name: "GitHub",
    pattern: /^https:\/\/github\.com\//,
  },
  gl: {
    base: "https://gitlab.com",
    name: "GitLab",
    pattern: /^https:\/\/gitlab\.com\//,
  },
  hf: {
    base: "https://huggingface.co",
    name: "Hugging Face",
    pattern: /^https:\/\/huggingface\.co\//,
  },
};

// 初始化内容脚本
(async function () {
  console.log("Xget for Chrome：内容脚本已加载");

  // 监听来自后台脚本的消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "showNotification") {
      showNotification(request.message, request.showRefreshButton);
      sendResponse({ success: true });
    }
  });

  // 检查扩展是否已启用并配置
  const settings = await getSettings();
  if (!settings.enabled || !settings.xgetDomain) {
    return;
  }

  // 找到当前平台
  const currentPlatform = detectPlatform(window.location.href);
  if (!currentPlatform || !settings.enabledPlatforms[currentPlatform]) {
    return;
  }

  // 添加下载拦截
  interceptDownloadLinks();

  // 监控动态添加的内容
  observePageChanges();
})();

async function getSettings() {
  try {
    return await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getSettings" }, resolve);
    });
  } catch (error) {
    console.error("获取设置时出错：", error);
    return { enabled: false };
  }
}

function detectPlatform(url) {
  for (const [key, platform] of Object.entries(PLATFORMS)) {
    if (platform.pattern.test(url)) {
      return key;
    }
  }
  return null;
}

function interceptDownloadLinks() {
  // 拦截下载链接的点击事件
  document.addEventListener(
    "click",
    async (event) => {
      const link = event.target.closest("a");
      if (!link || !link.href) return;

      // 检查这是否是下载链接
      if (isDownloadLink(link)) {
        event.preventDefault();
        event.stopPropagation();

        await handleDownloadLink(link.href);
      }
    },
    true
  );
}

function isDownloadLink(link) {
  const href = link.href.toLowerCase();
  const url = new URL(link.href);
  const pathname = url.pathname.toLowerCase();

  // 第一检查：明确的下载属性
  if (link.download || link.hasAttribute("download")) {
    return true;
  }

  // 第二检查：表示可下载文件的文件扩展名
  const fileExtensions = [
    ".zip",
    ".tar.gz",
    ".tar.bz2",
    ".tar.xz",
    ".7z",
    ".rar",
    ".gz",
    ".bz2",
    ".exe",
    ".msi",
    ".dmg",
    ".pkg",
    ".deb",
    ".rpm",
    ".apk",
    ".jar",
    ".war",
    ".ear",
    ".iso",
    ".img",
    ".pdf",
    ".doc",
    ".docx",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".mp4",
    ".avi",
    ".mkv",
    ".mov",
    ".wmv",
    ".flv",
    ".mp3",
    ".wav",
    ".flac",
    ".ogg",
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".bmp",
    ".tiff",
    ".svg",
    ".whl",
    ".egg",
    ".gem",
    ".nupkg",
  ];

  // 检查 URL 是否以文件扩展名结尾
  if (fileExtensions.some((ext) => pathname.endsWith(ext))) {
    return true;
  }

  // 第三检查：GitHub 特定模式
  const allowedGitHubHosts = ["github.com"];
  try {
    const parsedUrl = new URL(href);
    if (allowedGitHubHosts.includes(parsedUrl.host)) {
      // GitHub 发布资源下载 URL 遵循模式：/releases/download/
      if (pathname.includes("/releases/download/")) {
        return true;
      }
      // GitHub 存档下载 URL
      if (
        pathname.includes("/archive/") &&
        (pathname.endsWith(".zip") || pathname.endsWith(".tar.gz"))
      ) {
        return true;
      }
      // GitHub 原始文件 URL - 新增：支持原始文件链接
      if (pathname.includes("/raw/")) {
        return true;
      }
      // 排除导航到发布页面（仅 /releases 或 /releases/）
      if (pathname.endsWith("/releases") || pathname.endsWith("/releases/")) {
        return false;
      }
    }
  } catch (e) {
    console.error("无效的 URL：", href, e);
  }

  // 第四检查：GitLab 特定模式
  const allowedGitLabHosts = ["gitlab.com"];
  try {
    const parsedUrl = new URL(href);
    if (allowedGitLabHosts.includes(parsedUrl.host)) {
      // GitLab 存档下载
      if (pathname.includes("/-/archive/")) {
        return true;
      }
      // GitLab 发布下载
      if (
        pathname.includes("/-/releases/") &&
        pathname.includes("/downloads/")
      ) {
        return true;
      }
    }
  } catch (e) {
    console.error("无效的 URL：", href, e);
  }

  // 第五检查：Hugging Face 文件下载
  const allowedHuggingFaceHosts = ["huggingface.co"];
  try {
    const parsedUrl = new URL(href);
    if (allowedHuggingFaceHosts.includes(parsedUrl.host)) {
      // HF 文件下载 URL 包含 /resolve/
      if (pathname.includes("/resolve/")) {
        return true;
      }
    }
  } catch (e) {
    console.error("无效的 URL：", href, e);
  }

  // 第七检查：明确的下载文本指示器（更具体）
  const downloadTextIndicators = ["download", "download file", "get file"];
  const linkText = link.textContent.toLowerCase().trim();
  if (
    downloadTextIndicators.some(
      (indicator) =>
        linkText === indicator || linkText.startsWith(indicator + " ")
    )
  ) {
    return true;
  }

  // 默认：不是下载链接
  return false;
}

async function handleDownloadLink(url) {
  try {
    const settings = await getSettings();
    if (!settings.enabled || !settings.xgetDomain) return;

    const transformedUrl = transformUrl(url, settings);
    if (transformedUrl) {
      // 显示通知
      showNotification(`下载已通过 Xget 重定向`);

      // 触发下载
      window.location.href = transformedUrl;
    }
  } catch (error) {
    console.error("处理下载时出错：", error);
  }
}

function transformUrl(url, settings) {
  try {
    const platform = detectPlatform(url);
    if (!platform || !settings.enabledPlatforms[platform]) {
      return null;
    }

    const urlObj = new URL(url);
    const path = urlObj.pathname + urlObj.search + urlObj.hash;

    return `https://${settings.xgetDomain}/${platform}${path}`;
  } catch (error) {
    console.error("转换 URL 时出错：", error);
    return null;
  }
}

function observePageChanges() {
  const observer = new MutationObserver(() => {
    // 监控页面变化（无需额外操作）
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function showNotification(message, showRefreshButton = false) {
  try {
    // 首先删除所有现有通知
    const existingNotifications =
      document.querySelectorAll(".xget-notification");
    existingNotifications.forEach((notification) => notification.remove());

    // 创建一个简单的通知
    const notification = document.createElement("div");
    notification.className = "xget-notification";

    // 创建消息容器
    const messageDiv = document.createElement("div");
    messageDiv.textContent = message;
    messageDiv.style.marginBottom = showRefreshButton ? "8px" : "0";
    notification.appendChild(messageDiv);

    // 如果需要，添加刷新按钮
    if (showRefreshButton) {
      const refreshButton = document.createElement("button");
      refreshButton.textContent = "🔄 刷新页面";
      refreshButton.style.cssText = `
        background: rgba(255, 255, 255, 0.2);
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
        margin-top: 4px;
        width: 100%;
        transition: background 0.2s;
      `;

      refreshButton.addEventListener("mouseenter", () => {
        refreshButton.style.background = "rgba(255, 255, 255, 0.3)";
      });

      refreshButton.addEventListener("mouseleave", () => {
        refreshButton.style.background = "rgba(255, 255, 255, 0.2)";
      });

      refreshButton.addEventListener("click", () => {
        window.location.reload();
      });

      notification.appendChild(refreshButton);
    }

    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      z-index: 2147483647;
      animation: xgetSlideIn 0.3s ease-out;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 280px;
      word-wrap: break-word;
    `;

    // 如果尚未存在则添加动画样式
    if (!document.getElementById("xget-notification-styles")) {
      const style = document.createElement("style");
      style.id = "xget-notification-styles";
      style.textContent = `
        @keyframes xgetSlideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes xgetSlideOut {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(100%); opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(notification);

    // 如果有刷新按钮则在较长时间后删除，否则在较短时间后删除
    const removeDelay = showRefreshButton ? 8000 : 4000;
    setTimeout(() => {
      notification.style.animation = "xgetSlideOut 0.3s ease-in";
      setTimeout(() => {
        if (notification.parentNode) {
          notification.remove();
        }
      }, 300);
    }, removeDelay);
  } catch (error) {
    console.error("显示通知时出错：", error);
    // 如果 DOM 操作失败则回退到控制台日志
    console.log("Xget 通知：", message);
  }
}
