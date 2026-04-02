import {
  debounce as _debounce,
  throttle as _throttle,
  cloneDeep as _cloneDeep,
  merge as _merge,
  mergeWith as _mergeWith,
  uniq as _uniq,
  isEmpty as _isEmpty,
  isEqual as _isEqual,
  get as _get,
  set as _set,
  has as _has,
  omit as _omit,
  pick as _pick,
  isPlainObject as _isPlainObject,
  isArray as _isArray
} from 'lodash-es';

/**
 * 防抖
 * 默认首次立即执行，禁止 trailing
 */
export const debounce = (fn, wait = 300, options = { leading: true, trailing: false }) => {
  return _debounce(fn, wait, options);
};

/**
 * 节流
 * 默认每隔 wait ms 执行一次
 */
export const throttle = (fn, wait = 300, options = { leading: true, trailing: true }) => {
  return _throttle(fn, wait, options);
};

/**
 * 深拷贝
 */
export const cloneDeep = (value) => _cloneDeep(value);

/**
 * 深度合并对象
 */
export const merge = (target, source) => _merge(target, _cloneDeep(source));

/**
 * 深度重置状态
 */
export const resetState = (target, ...sources) => {
  if (!sources.length) return target;
  const source = Object.assign({}, ...sources);
  if (_isPlainObject(target) && _isPlainObject(source)) {
    Object.keys(target).forEach(key => {
      if (!(key in source)) delete target[key];
    });
  }
  _mergeWith(target, _cloneDeep(source), (_, srcValue) => {
    if (_isArray(srcValue)) return srcValue;
    if (srcValue instanceof Date) return new Date(srcValue);
    return undefined;
  });

  return target;
}

/**
 * 数组去重
 */
export const uniq = (array) => _uniq(array);

/**
 * 判断是否为空
 */
export const isEmpty = (value) => _isEmpty(value);

/**
 * 深度比较两个值是否相等
 */
export const isEqual = (value, other) => _isEqual(value, other);

/**
 * 安全获取对象属性，支持默认值
 */
export const get = (obj, path, defaultValue) => _get(obj, path, defaultValue);

/**
 * 安全设置对象属性
 */
export const set = (obj, path, value) => _set(obj, path, value);

/**
 * 判断对象是否存在指定属性
 */
export const has = (obj, path) => _has(obj, path);

/**
 * 剔除对象的部分属性
 */
export const omit = (obj, paths) => _omit(obj, paths);

/**
 * 只获取对象的部分属性
 */
export const pick = (obj, paths) => _pick(obj, paths);

/**
 * 递归过滤对象或数组中的空值，保留 0 和 false
 */
export const filterEmptyValue = (value) => {
  const data = _cloneDeep(value);

  const filter = (val) => {
    if (_isArray(val)) {
      return val
        .map(item => filter(item))
        .filter(item => item !== null && item !== undefined && item !== '');
    } else if (_isPlainObject(val)) {
      const result = {};
      Object.keys(val).forEach(key => {
        const filtered = filter(val[key]);
        // 只删除 null, undefined, 空字符串, 空对象, 空数组
        if (
          filtered !== null &&
          filtered !== undefined &&
          filtered !== '' &&
          !(_isArray(filtered) && filtered.length === 0) &&
          !(_isPlainObject(filtered) && Object.keys(filtered).length === 0)
        ) {
          result[key] = filtered;
        }
      });
      return result;
    }
    return val; // 数字、布尔、字符串（非空）直接返回
  };

  return filter(data);
};

/**
 * 只过滤对象第一层空值，保留 0 和 false
 */
export const filterEmptyValueShallow = (obj) => {
  if (!_isPlainObject(obj)) return obj;
  const result = {};
  Object.keys(obj).forEach(key => {
    const value = obj[key];
    if (
      value !== null &&
      value !== undefined &&
      value !== '' &&
      !(_isArray(value) && value.length === 0) &&
      !(_isPlainObject(value) && Object.keys(value).length === 0)
    ) {
      result[key] = value;
    }
  });
  return result;
};