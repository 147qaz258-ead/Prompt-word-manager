// PromptMaster 存储管理模块
// 处理Chrome扩展的存储和数据管理

import { CONFIG, DEFAULT_SETTINGS, MESSAGE_TYPES } from './config.js';
import { Logger, ErrorHandler, TimeUtils } from './utils.js';

/**
 * 存储管理类
 */
export class StorageManager {
  constructor() {
    this.initialized = false;
    this.cache = new Map();
  }

  /**
   * 初始化存储管理器
   */
  async init() {
    if (this.initialized) return;

    try {
      // 加载基本配置到缓存
      await this.loadSettings();
      await this.loadFeishuConfig();
      await this.loadCache();

      this.initialized = true;
      Logger.info('存储管理器初始化完成');
    } catch (error) {
      Logger.error('存储管理器初始化失败', { error });
      throw error;
    }
  }

  /**
   * 通用存储操作
   */
  async storageGet(keys) {
    try {
      const result = await chrome.storage.sync.get(keys);
      return result;
    } catch (error) {
      Logger.error('存储读取失败', { keys, error });
      throw ErrorHandler.handleError(error, 'StorageManager', 'storageGet');
    }
  }

  async storageSet(data) {
    try {
      await chrome.storage.sync.set(data);
      Logger.debug('存储写入成功', { keys: Object.keys(data) });
    } catch (error) {
      Logger.error('存储写入失败', { data, error });
      throw ErrorHandler.handleError(error, 'StorageManager', 'storageSet');
    }
  }

  async storageRemove(keys) {
    try {
      await chrome.storage.sync.remove(keys);
      Logger.debug('存储删除成功', { keys });
    } catch (error) {
      Logger.error('存储删除失败', { keys, error });
      throw ErrorHandler.handleError(error, 'StorageManager', 'storageRemove');
    }
  }

  /**
   * 本地存储操作
   */
  async localGet(keys) {
    try {
      const result = await chrome.storage.local.get(keys);
      return result;
    } catch (error) {
      Logger.error('本地存储读取失败', { keys, error });
      throw ErrorHandler.handleError(error, 'StorageManager', 'localGet');
    }
  }

  async localSet(data) {
    try {
      await chrome.storage.local.set(data);
      Logger.debug('本地存储写入成功', { keys: Object.keys(data) });
    } catch (error) {
      Logger.error('本地存储写入失败', { data, error });
      throw ErrorHandler.handleError(error, 'StorageManager', 'localSet');
    }
  }

  async localRemove(keys) {
    try {
      await chrome.storage.local.remove(keys);
      Logger.debug('本地存储删除成功', { keys });
    } catch (error) {
      Logger.error('本地存储删除失败', { keys, error });
      throw ErrorHandler.handleError(error, 'StorageManager', 'localRemove');
    }
  }

  /**
   * 设置管理
   */
  async loadSettings() {
    try {
      const result = await this.storageGet([CONFIG.STORAGE_KEYS.SETTINGS]);
      const settings = result[CONFIG.STORAGE_KEYS.SETTINGS] || DEFAULT_SETTINGS;

      this.cache.set('settings', settings);
      return settings;
    } catch (error) {
      Logger.error('加载设置失败', { error });
      return DEFAULT_SETTINGS;
    }
  }

  async saveSettings(settings) {
    try {
      await this.storageSet({ [CONFIG.STORAGE_KEYS.SETTINGS]: settings });
      this.cache.set('settings', settings);
      Logger.info('设置保存成功');
    } catch (error) {
      Logger.error('保存设置失败', { error });
      throw error;
    }
  }

  getSettings() {
    return this.cache.get('settings') || DEFAULT_SETTINGS;
  }

  /**
   * 飞书配置管理
   */
  async loadFeishuConfig() {
    try {
      const result = await this.storageGet([CONFIG.STORAGE_KEYS.FEISHU_CONFIG]);
      const config = result[CONFIG.STORAGE_KEYS.FEISHU_CONFIG] || {};

      // 加载配置模式
      const modeResult = await this.storageGet([CONFIG.STORAGE_KEYS.CONFIG_MODE]);
      const configMode = modeResult[CONFIG.STORAGE_KEYS.CONFIG_MODE] || 'benefit';

      const fullConfig = {
        ...config,
        configMode
      };

      this.cache.set('feishuConfig', fullConfig);
      return fullConfig;
    } catch (error) {
      Logger.error('加载飞书配置失败', { error });
      return { configMode: 'benefit' };
    }
  }

  async saveFeishuConfig(config) {
    try {
      const { configMode, ...feishuConfig } = config;

      await this.storageSet({
        [CONFIG.STORAGE_KEYS.FEISHU_CONFIG]: feishuConfig,
        [CONFIG.STORAGE_KEYS.CONFIG_MODE]: configMode
      });

      this.cache.set('feishuConfig', config);
      Logger.info('飞书配置保存成功');
    } catch (error) {
      Logger.error('保存飞书配置失败', { error });
      throw error;
    }
  }

  getFeishuConfig() {
    return this.cache.get('feishuConfig') || { configMode: 'benefit' };
  }

  /**
   * 缓存管理
   */
  async loadCache() {
    try {
      const result = await this.storageGet([CONFIG.STORAGE_KEYS.CACHE]);
      const cache = result[CONFIG.STORAGE_KEYS.CACHE] || {};

      // 清理过期缓存
      const now = Date.now();
      const cleanedCache = {};

      Object.keys(cache).forEach(key => {
        const item = cache[key];
        if (!TimeUtils.isExpired(item.timestamp, CONFIG.CACHE_DURATION)) {
          cleanedCache[key] = item;
        }
      });

      this.cache.set('cache', cleanedCache);
      return cleanedCache;
    } catch (error) {
      Logger.error('加载缓存失败', { error });
      return {};
    }
  }

  async setCache(key, data) {
    try {
      const cache = this.cache.get('cache') || {};
      cache[key] = {
        data,
        timestamp: Date.now()
      };

      await this.storageSet({ [CONFIG.STORAGE_KEYS.CACHE]: cache });
      this.cache.set('cache', cache);

      Logger.debug('缓存设置成功', { key });
    } catch (error) {
      Logger.error('设置缓存失败', { key, error });
      throw error;
    }
  }

  getCache(key) {
    const cache = this.cache.get('cache') || {};
    const item = cache[key];

    if (!item) return null;

    if (TimeUtils.isExpired(item.timestamp, CONFIG.CACHE_DURATION)) {
      delete cache[key];
      this.cache.set('cache', cache);
      return null;
    }

    return item.data;
  }

  async clearCache() {
    try {
      await this.storageRemove([CONFIG.STORAGE_KEYS.CACHE]);
      this.cache.set('cache', {});
      Logger.info('缓存清除成功');
    } catch (error) {
      Logger.error('清除缓存失败', { error });
      throw error;
    }
  }

  /**
   * 最近使用管理
   */
  async getRecentPrompts() {
    try {
      const result = await this.storageGet([CONFIG.STORAGE_KEYS.RECENT_PROMPTS]);
      return result[CONFIG.STORAGE_KEYS.RECENT_PROMPTS] || [];
    } catch (error) {
      Logger.error('获取最近提示词失败', { error });
      return [];
    }
  }

  async addRecentPrompt(prompt) {
    try {
      const recent = await this.getRecentPrompts();
      const settings = this.getSettings();

      // 移除重复项
      const filtered = recent.filter(item => item.id !== prompt.id);

      // 添加到开头
      filtered.unshift({
        id: prompt.id,
        prompt: prompt.prompt,
        category: prompt.category,
        usedAt: Date.now()
      });

      // 限制数量
      const limited = filtered.slice(0, settings.maxRecentItems);

      await this.storageSet({ [CONFIG.STORAGE_KEYS.RECENT_PROMPTS]: limited });
      Logger.debug('最近提示词添加成功', { promptId: prompt.id });
    } catch (error) {
      Logger.error('添加最近提示词失败', { error });
      throw error;
    }
  }

  async clearRecentPrompts() {
    try {
      await this.storageRemove([CONFIG.STORAGE_KEYS.RECENT_PROMPTS]);
      Logger.info('最近提示词清除成功');
    } catch (error) {
      Logger.error('清除最近提示词失败', { error });
      throw error;
    }
  }

  /**
   * 永久存储管理
   */
  async getPermanentPrompts() {
    try {
      const result = await this.localGet([CONFIG.STORAGE_KEYS.PERMANENT_PROMPTS]);
      return result[CONFIG.STORAGE_KEYS.PERMANENT_PROMPTS] || [];
    } catch (error) {
      Logger.error('获取永久提示词失败', { error });
      return [];
    }
  }

  async savePermanentPrompts(prompts) {
    try {
      const data = {
        prompts,
        count: prompts.length,
        lastUpdated: Date.now()
      };

      await this.localSet({ [CONFIG.STORAGE_KEYS.PERMANENT_PROMPTS]: data });
      Logger.info('永久提示词保存成功', { count: prompts.length });
    } catch (error) {
      Logger.error('保存永久提示词失败', { error });
      throw error;
    }
  }

  async getPermanentPromptsInfo() {
    try {
      const result = await this.localGet([CONFIG.STORAGE_KEYS.PERMANENT_PROMPTS]);
      const data = result[CONFIG.STORAGE_KEYS.PERMANENT_PROMPTS];

      if (!data) {
        return {
          hasPermanentData: false,
          count: 0,
          lastUpdated: null
        };
      }

      return {
        hasPermanentData: true,
        count: data.count || 0,
        lastUpdated: data.lastUpdated ? TimeUtils.formatTimestamp(data.lastUpdated) : null
      };
    } catch (error) {
      Logger.error('获取永久提示词信息失败', { error });
      return {
        hasPermanentData: false,
        count: 0,
        lastUpdated: null
      };
    }
  }

  async clearPermanentPrompts() {
    try {
      await this.localRemove([CONFIG.STORAGE_KEYS.PERMANENT_PROMPTS]);
      Logger.info('永久提示词清除成功');
    } catch (error) {
      Logger.error('清除永久提示词失败', { error });
      throw error;
    }
  }

  /**
   * 访问令牌管理
   */
  async getAccessToken() {
    try {
      const result = await this.storageGet([CONFIG.STORAGE_KEYS.ACCESS_TOKEN]);
      const tokenData = result[CONFIG.STORAGE_KEYS.ACCESS_TOKEN];

      if (!tokenData) return null;

      if (TimeUtils.isExpired(tokenData.timestamp, CONFIG.TOKEN_CACHE_DURATION)) {
        await this.storageRemove([CONFIG.STORAGE_KEYS.ACCESS_TOKEN]);
        return null;
      }

      return tokenData.token;
    } catch (error) {
      Logger.error('获取访问令牌失败', { error });
      return null;
    }
  }

  async saveAccessToken(token) {
    try {
      await this.storageSet({
        [CONFIG.STORAGE_KEYS.ACCESS_TOKEN]: {
          token,
          timestamp: Date.now()
        }
      });
      Logger.debug('访问令牌保存成功');
    } catch (error) {
      Logger.error('保存访问令牌失败', { error });
      throw error;
    }
  }

  async clearAccessToken() {
    try {
      await this.storageRemove([CONFIG.STORAGE_KEYS.ACCESS_TOKEN]);
      Logger.info('访问令牌清除成功');
    } catch (error) {
      Logger.error('清除访问令牌失败', { error });
      throw error;
    }
  }

  /**
   * 最后刷新时间管理
   */
  async getLastRefreshTime() {
    try {
      const result = await this.storageGet([CONFIG.STORAGE_KEYS.LAST_REFRESH_TIME]);
      return result[CONFIG.STORAGE_KEYS.LAST_REFRESH_TIME] || null;
    } catch (error) {
      Logger.error('获取最后刷新时间失败', { error });
      return null;
    }
  }

  async saveLastRefreshTime() {
    try {
      await this.storageSet({
        [CONFIG.STORAGE_KEYS.LAST_REFRESH_TIME]: Date.now()
      });
      Logger.debug('最后刷新时间保存成功');
    } catch (error) {
      Logger.error('保存最后刷新时间失败', { error });
      throw error;
    }
  }

  /**
   * 导出和导入数据
   */
  async exportData() {
    try {
      const settings = await this.loadSettings();
      const feishuConfig = await this.loadFeishuConfig();
      const recentPrompts = await this.getRecentPrompts();
      const permanentData = await this.getPermanentPrompts();

      return {
        settings,
        feishuConfig,
        recentPrompts,
        permanentData,
        exportTime: Date.now(),
        version: '1.0'
      };
    } catch (error) {
      Logger.error('导出数据失败', { error });
      throw error;
    }
  }

  async importData(data) {
    try {
      if (data.settings) {
        await this.saveSettings(data.settings);
      }

      if (data.feishuConfig) {
        await this.saveFeishuConfig(data.feishuConfig);
      }

      if (data.recentPrompts) {
        await this.storageSet({ [CONFIG.STORAGE_KEYS.RECENT_PROMPTS]: data.recentPrompts });
      }

      if (data.permanentData) {
        await this.savePermanentPrompts(data.permanentData.prompts || []);
      }

      Logger.info('数据导入成功');
    } catch (error) {
      Logger.error('导入数据失败', { error });
      throw error;
    }
  }

  /**
   * 清除所有数据
   */
  async clearAllData() {
    try {
      const keys = Object.values(CONFIG.STORAGE_KEYS);
      await this.storageRemove(keys);
      await this.localRemove(keys);

      this.cache.clear();
      Logger.info('所有数据清除成功');
    } catch (error) {
      Logger.error('清除所有数据失败', { error });
      throw error;
    }
  }
}

// 创建单例实例
export const storageManager = new StorageManager();

// 默认导出
export default StorageManager;