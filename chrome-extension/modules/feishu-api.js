// PromptMaster 飞书API服务模块
// 处理飞书API调用和数据获取

import { CONFIG, BENEFIT_CONFIG, MESSAGE_TYPES, ERROR_CODES } from './config.js';
import { Logger, ErrorHandler, Validator, TimeUtils, CacheUtils } from './utils.js';

/**
 * 飞书API服务类
 */
export class FeishuApiService {
  constructor() {
    this.config = null;
    this.accessToken = null;
    this.tokenExpiry = 0;
  }

  /**
   * 初始化配置
   */
  async initConfig(userConfig = {}) {
    if (this.config) return this.config;

    const configMode = userConfig.configMode || 'benefit';

    if (configMode === 'custom') {
      // 自定义模式：使用用户提供的完整配置
      this.config = {
        ...userConfig,
        appId: userConfig.appId || '',
        appSecret: userConfig.appSecret || '',
        bitableAppToken: userConfig.bitableAppToken || '',
        bitableTableId: userConfig.bitableTableId || ''
      };
      Logger.info('使用用户自定义飞书应用配置');
    } else {
      // 福利模式：使用内置表格配置，用户只提供应用信息
      this.config = {
        ...BENEFIT_CONFIG,
        appId: userConfig.appId || '',
        appSecret: userConfig.appSecret || '',
        ...userConfig
      };
      Logger.info('使用内置精选提示词库表格');
    }

    return this.config;
  }

  /**
   * 获取访问令牌
   */
  async getAccessToken() {
    // 检查token是否有效
    if (this.accessToken && !TimeUtils.isExpired(this.tokenExpiry, CONFIG.TOKEN_CACHE_DURATION)) {
      Logger.debug('使用缓存的访问令牌');
      return this.accessToken;
    }

    try {
      const response = await fetch(`${CONFIG.FEISHU_BASE_URL}/auth/v3/tenant_access_token/internal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8'
        },
        body: JSON.stringify({
          app_id: this.config.appId,
          app_secret: this.config.appSecret
        })
      });

      const data = await response.json();

      if (data.code === 0 && data.data.tenant_access_token) {
        this.accessToken = data.data.tenant_access_token;
        this.tokenExpiry = Date.now();
        Logger.info('成功获取访问令牌');
        return this.accessToken;
      } else {
        throw ErrorHandler.createError(
          `获取访问令牌失败: ${data.msg}`,
          ERROR_CODES.AUTH_ERROR,
          'FeishuApiService.getAccessToken'
        );
      }
    } catch (error) {
      throw ErrorHandler.handleError(error, 'FeishuApiService', 'getAccessToken');
    }
  }

  /**
   * 发送API请求
   */
  async apiRequest(endpoint, options = {}) {
    const accessToken = await this.getAccessToken();

    const url = `${CONFIG.FEISHU_BASE_URL}${endpoint}`;
    const defaultOptions = {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=utf-8'
      }
    };

    const requestOptions = {
      ...defaultOptions,
      ...options,
      headers: {
        ...defaultOptions.headers,
        ...(options.headers || {})
      }
    };

    try {
      Logger.debug(`发送API请求: ${endpoint}`, requestOptions);
      const response = await fetch(url, requestOptions);
      const data = await response.json();

      if (data.code === 0) {
        return data;
      } else {
        // 处理特定的错误代码
        if (data.code === 99991663 || data.code === 99991668) {
          // token无效，清除缓存
          this.accessToken = null;
          this.tokenExpiry = 0;
          throw ErrorHandler.createError(
            `访问令牌无效: ${data.msg}`,
            ERROR_CODES.AUTH_ERROR,
            'FeishuApiService.apiRequest'
          );
        } else if (data.code === 99991661) {
          throw ErrorHandler.createError(
            `请求频率过高: ${data.msg}`,
            ERROR_CODES.RATE_LIMIT_ERROR,
            'FeishuApiService.apiRequest'
          );
        } else {
          throw ErrorHandler.createError(
            `API请求失败: ${data.msg}`,
            ERROR_CODES.UNKNOWN_ERROR,
            'FeishuApiService.apiRequest'
          );
        }
      }
    } catch (error) {
      throw ErrorHandler.handleError(error, 'FeishuApiService', 'apiRequest');
    }
  }

  /**
   * 搜索提示词
   */
  async searchPrompts(keyword, options = {}) {
    const { pageSize = 50, filter = {} } = options;

    try {
      // 构建过滤条件
      const filterConditions = [];

      if (keyword) {
        filterConditions.push({
          field_name: 'prompt',
          operator: 'contains',
          value: keyword
        });
      }

      if (filter.category) {
        filterConditions.push({
          field_name: 'category',
          operator: 'is',
          value: filter.category
        });
      }

      if (filter.tags && filter.tags.length > 0) {
        filterConditions.push({
          field_name: 'tags',
          operator: 'contains',
          value: filter.tags.join(',')
        });
      }

      const requestBody = {
        page_size: Math.min(pageSize, CONFIG.MAX_PAGE_SIZE)
      };

      if (filterConditions.length > 0) {
        requestBody.filter = {
          conjunction: 'AND',
          conditions: filterConditions
        };
      }

      const response = await this.apiRequest(
        `/bitable/v1/apps/${this.config.bitableAppToken}/tables/${this.config.bitableTableId}/records/search`,
        {
          method: 'POST',
          body: JSON.stringify(requestBody)
        }
      );

      const prompts = this.processPromptData(response.data.items || []);

      Logger.info(`搜索完成，找到 ${prompts.length} 条提示词`, { keyword, count: prompts.length });

      return {
        success: true,
        data: {
          prompts,
          total: response.data.total || 0,
          hasMore: response.data.has_more || false,
          pageToken: response.data.page_token || null
        }
      };

    } catch (error) {
      Logger.error('搜索提示词失败', { keyword, error });
      return {
        success: false,
        error: error.message,
        data: { prompts: [], total: 0, hasMore: false, pageToken: null }
      };
    }
  }

  /**
   * 获取所有提示词
   */
  async getAllPrompts(options = {}) {
    const { pageSize = CONFIG.MAX_PAGE_SIZE, maxRecords = CONFIG.MAX_RECORDS_LIMIT } = options;

    try {
      let allPrompts = [];
      let pageToken = null;
      let totalFetched = 0;

      do {
        const requestBody = {
          page_size: Math.min(pageSize, CONFIG.MAX_PAGE_SIZE)
        };

        if (pageToken) {
          requestBody.page_token = pageToken;
        }

        const response = await this.apiRequest(
          `/bitable/v1/apps/${this.config.bitableAppToken}/tables/${this.config.bitableTableId}/records`,
          {
            method: 'GET'
          }
        );

        const prompts = this.processPromptData(response.data.items || []);
        allPrompts = allPrompts.concat(prompts);
        totalFetched += prompts.length;

        pageToken = response.data.page_token;

        Logger.debug(`获取提示词进度: ${totalFetched} 条`);

        // 检查数据量限制
        if (totalFetched >= maxRecords) {
          Logger.warn(`已达到最大数据量限制: ${maxRecords}`);
          break;
        }

        // 检查警告阈值
        if (totalFetched >= CONFIG.MAX_RECORDS_WARNING && totalFetched === CONFIG.MAX_RECORDS_WARNING) {
          Logger.warn(`数据量已接近警告阈值: ${CONFIG.MAX_RECORDS_WARNING}`);
        }

      } while (pageToken);

      Logger.info(`获取所有提示词完成，共 ${allPrompts.length} 条`);

      return {
        success: true,
        data: {
          prompts: allPrompts,
          total: allPrompts.length,
          lastRefreshTime: new Date().toISOString()
        }
      };

    } catch (error) {
      Logger.error('获取所有提示词失败', { error });
      return {
        success: false,
        error: error.message,
        data: { prompts: [], total: 0, lastRefreshTime: null }
      };
    }
  }

  /**
   * 处理提示词数据
   */
  processPromptData(items) {
    return items.map(item => {
      const fields = item.fields;

      return {
        id: item.record_id,
        prompt: fields.prompt || '',
        category: fields.category || '其他',
        tags: this.parseTags(fields.tags),
        description: fields.description || '',
        usage: fields.usage || '',
        variables: this.parseVariables(fields.variables),
        examples: this.parseExamples(fields.examples),
        priority: parseInt(fields.priority) || 0,
        isActive: fields.is_active !== false,
        createdAt: fields.created_time || '',
        updatedAt: fields.updated_time || ''
      };
    }).filter(prompt => prompt.prompt); // 过滤掉没有提示词内容的记录
  }

  /**
   * 解析标签
   */
  parseTags(tags) {
    if (!tags) return [];
    if (Array.isArray(tags)) return tags;
    if (typeof tags === 'string') {
      return tags.split(',').map(tag => tag.trim()).filter(tag => tag);
    }
    return [];
  }

  /**
   * 解析变量
   */
  parseVariables(variables) {
    if (!variables) return [];
    if (Array.isArray(variables)) return variables;
    if (typeof variables === 'string') {
      try {
        return JSON.parse(variables);
      } catch {
        return variables.split(',').map(v => v.trim()).filter(v => v);
      }
    }
    return [];
  }

  /**
   * 解析示例
   */
  parseExamples(examples) {
    if (!examples) return [];
    if (Array.isArray(examples)) return examples;
    if (typeof examples === 'string') {
      try {
        return JSON.parse(examples);
      } catch {
        return examples.split('\n').map(e => e.trim()).filter(e => e);
      }
    }
    return [];
  }

  /**
   * 测试连接
   */
  async testConnection() {
    try {
      const validation = Validator.validateFeishuConfig(this.config);
      if (!validation.isValid) {
        return {
          connected: false,
          message: `配置验证失败: ${validation.errors.join(', ')}`,
          error: 'CONFIG_ERROR'
        };
      }

      // 尝试获取访问令牌
      await this.getAccessToken();

      // 尝试获取一条记录来验证连接
      const testResponse = await this.apiRequest(
        `/bitable/v1/apps/${this.config.bitableAppToken}/tables/${this.config.bitableTableId}/records`,
        {
          method: 'GET'
        }
      );

      return {
        connected: true,
        message: '连接成功',
        total: testResponse.data?.total || 0
      };

    } catch (error) {
      Logger.error('连接测试失败', { error });
      return {
        connected: false,
        message: error.message,
        error: error.code
      };
    }
  }

  /**
   * 清除缓存
   */
  clearCache() {
    this.accessToken = null;
    this.tokenExpiry = 0;
    CacheUtils.clearCache('feishu_');
    Logger.info('已清除飞书API缓存');
  }
}

// 创建单例实例
export const feishuApiService = new FeishuApiService();

// 默认导出
export default FeishuApiService;