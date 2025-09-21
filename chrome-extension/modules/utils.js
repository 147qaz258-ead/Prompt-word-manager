// PromptMaster 工具函数模块
// 通用工具和辅助函数

import { CONFIG, ERROR_CODES, REGEX } from './config.js';

/**
 * 日志工具类
 */
export class Logger {
  static levels = {
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug'
  };

  static log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    switch (level) {
      case this.levels.ERROR:
        console.error(prefix, message, data);
        break;
      case this.levels.WARN:
        console.warn(prefix, message, data);
        break;
      case this.levels.INFO:
        console.info(prefix, message, data);
        break;
      case this.levels.DEBUG:
        console.debug(prefix, message, data);
        break;
      default:
        console.log(prefix, message, data);
    }
  }

  static error(message, data) { this.log(this.levels.ERROR, message, data); }
  static warn(message, data) { this.log(this.levels.WARN, message, data); }
  static info(message, data) { this.log(this.levels.INFO, message, data); }
  static debug(message, data) { this.log(this.levels.DEBUG, message, data); }
}

/**
 * 错误处理工具类
 */
export class ErrorHandler {
  static handleError(error, context = '', operation = '') {
    Logger.error(`Error in ${context}:${operation}`, error);

    const errorInfo = {
      message: error.message || '未知错误',
      code: error.code || ERROR_CODES.UNKNOWN_ERROR,
      context,
      operation,
      timestamp: new Date().toISOString()
    };

    // 根据错误类型进行分类处理
    if (error.message?.includes('network') || error.message?.includes('fetch')) {
      errorInfo.code = ERROR_CODES.NETWORK_ERROR;
      errorInfo.userMessage = '网络连接失败，请检查网络设置';
    } else if (error.message?.includes('auth') || error.message?.includes('token')) {
      errorInfo.code = ERROR_CODES.AUTH_ERROR;
      errorInfo.userMessage = '认证失败，请检查配置信息';
    } else if (error.message?.includes('config')) {
      errorInfo.code = ERROR_CODES.CONFIG_ERROR;
      errorInfo.userMessage = '配置错误，请检查设置';
    } else if (error.message?.includes('rate limit')) {
      errorInfo.code = ERROR_CODES.RATE_LIMIT_ERROR;
      errorInfo.userMessage = '请求过于频繁，请稍后重试';
    } else {
      errorInfo.userMessage = '操作失败，请重试';
    }

    return errorInfo;
  }

  static createError(message, code = ERROR_CODES.UNKNOWN_ERROR, context = '') {
    const error = new Error(message);
    error.code = code;
    error.context = context;
    error.timestamp = new Date().toISOString();
    return error;
  }
}

/**
 * 验证工具类
 */
export class Validator {
  static validateAppId(appId) {
    if (!appId) return false;
    return REGEX.APP_ID.test(appId);
  }

  static validateTableId(tableId) {
    if (!tableId) return false;
    return REGEX.TABLE_ID.test(tableId);
  }

  static validateUrl(url) {
    if (!url) return false;
    return REGEX.URL_PATTERN.test(url);
  }

  static validateFeishuConfig(config) {
    const errors = [];

    if (!config.appId) {
      errors.push('App ID 不能为空');
    } else if (!this.validateAppId(config.appId)) {
      errors.push('App ID 格式不正确，应以 "cli_" 开头');
    }

    if (!config.appSecret) {
      errors.push('App Secret 不能为空');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  static validateSettings(settings) {
    const errors = [];

    if (!settings.triggerChar) {
      errors.push('触发字符不能为空');
    } else if (settings.triggerChar.length > 1) {
      errors.push('触发字符只能是单个字符');
    }

    if (settings.maxRecentItems < 5 || settings.maxRecentItems > 50) {
      errors.push('最近使用数量必须在 5-50 之间');
    }

    if (settings.autoRefresh && settings.autoRefresh.interval) {
      const interval = settings.autoRefresh.interval;
      if (interval < 5) {
        errors.push('自动刷新间隔不能小于 5 分钟');
      } else if (interval > 1440) {
        errors.push('自动刷新间隔不能大于 1440 分钟 (24小时)');
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

/**
 * 时间工具类
 */
export class TimeUtils {
  static formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN');
  }

  static formatDuration(milliseconds) {
    const minutes = Math.floor(milliseconds / (1000 * 60));
    const seconds = Math.floor((milliseconds % (1000 * 60)) / 1000);
    return `${minutes}分${seconds}秒`;
  }

  static isExpired(timestamp, duration) {
    const now = Date.now();
    return (now - timestamp) > duration;
  }

  static getRemainingTime(timestamp, duration) {
    const now = Date.now();
    const elapsed = now - timestamp;
    const remaining = duration - elapsed;
    return Math.max(0, remaining);
  }
}

/**
 * 缓存工具类
 */
export class CacheUtils {
  static setCache(key, data, duration = CONFIG.CACHE_DURATION) {
    const cacheData = {
      data,
      timestamp: Date.now(),
      duration
    };

    try {
      localStorage.setItem(key, JSON.stringify(cacheData));
      return true;
    } catch (error) {
      Logger.error('Failed to set cache', { key, error });
      return false;
    }
  }

  static getCache(key) {
    try {
      const cached = localStorage.getItem(key);
      if (!cached) return null;

      const cacheData = JSON.parse(cached);

      if (TimeUtils.isExpired(cacheData.timestamp, cacheData.duration)) {
        localStorage.removeItem(key);
        return null;
      }

      return cacheData.data;
    } catch (error) {
      Logger.error('Failed to get cache', { key, error });
      return null;
    }
  }

  static clearCache(pattern = null) {
    try {
      if (pattern) {
        // 清除匹配模式的缓存
        Object.keys(localStorage).forEach(key => {
          if (key.includes(pattern)) {
            localStorage.removeItem(key);
          }
        });
      } else {
        // 清除所有缓存
        Object.keys(localStorage).forEach(key => {
          if (key.startsWith('promptmaster_')) {
            localStorage.removeItem(key);
          }
        });
      }
      return true;
    } catch (error) {
      Logger.error('Failed to clear cache', { pattern, error });
      return false;
    }
  }
}

/**
 * 数据处理工具类
 */
export class DataUtils {
  static debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  static throttle(func, limit) {
    let inThrottle;
    return function(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  static escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  static truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  static formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

// 默认导出
export default {
  Logger,
  ErrorHandler,
  Validator,
  TimeUtils,
  CacheUtils,
  DataUtils
};