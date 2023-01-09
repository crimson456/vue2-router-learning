/* @flow */

import { warn } from './warn'

const encodeReserveRE = /[!'()*]/g
const encodeReserveReplacer = c => '%' + c.charCodeAt(0).toString(16)
const commaRE = /%2C/g

// fixed encodeURIComponent which is more conformant to RFC3986:
// - escapes [!'()*]
// - preserve commas
const encode = str =>
  encodeURIComponent(str)
    .replace(encodeReserveRE, encodeReserveReplacer)
    .replace(commaRE, ',')

export function decode (str: string) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      warn(false, `Error decoding "${str}". Leaving it intact.`)
    }
  }
  return str
}

// resolveQuery( parsedPath.query, next.query, router && router.options.parseQuery )
// 根据parseQuery函数解析query参数并和第二个参数
export function resolveQuery (
  query: ?string,                               // 路径path中的query参数字符串
  extraQuery: Dictionary<string> = {},          // 合并入query参数中的其他参数对象,应该为location对象中给定的query对象(会覆盖原query参数)
  _parseQuery: ?Function                        // 创建router时自定义的parseQuery函数
): Dictionary<string> {
  // 如果没有自定义的parseQuery函数，则使用默认
  const parse = _parseQuery || parseQuery
  let parsedQuery
  // 调用parseQuery函数,返回参数对象
  try {
    parsedQuery = parse(query || '')
  } catch (e) {
    process.env.NODE_ENV !== 'production' && warn(false, e.message)
    parsedQuery = {}
  }

  // 将extraQuery中的项覆盖到参数对象中
  for (const key in extraQuery) {
    const value = extraQuery[key]
    // 将extraQuery中的每一项转化为字符串，如果成员为数组，则将数组的每一项也转化为字符串
    parsedQuery[key] = Array.isArray(value)
      ? value.map(castQueryParamValue)
      : castQueryParamValue(value)
  }
  // 返回最后的结果对象
  return parsedQuery
}

const castQueryParamValue = value => (value == null || typeof value === 'object' ? value : String(value))

// 默认的解析query字符串生成参数对象的方法
function parseQuery (query: string): Dictionary<string> {
  const res = {}
  // 去掉两端空格，开头的 ? # & 符号        ???为何也要去除#和&
  query = query.trim().replace(/^(\?|#|&)/, '')
  // 不能存在query则返回空对象
  if (!query) {
    return res
  }
  // 以&分割参数  key1=value1&key2=value2&.....
  query.split('&').forEach(param => {
    // 去掉 \ 并以 = 分割
    const parts = param.replace(/\+/g, ' ').split('=')
    // 解码获得key和value
    // 取第一段为key
    const key = decode(parts.shift())
    // 此处处理了value中包含等号的问题
    const val = parts.length > 0 ? decode(parts.join('=')) : null

    // 如果结果对象中不存在，直接复制
    if (res[key] === undefined) {
      res[key] = val
    }
    // 结果对象中存在且为数组，则推入数组
    else if (Array.isArray(res[key])) {
      res[key].push(val)
    }
    // 结果对象中存在且不为数组，生成数组并推入
    else {
      res[key] = [res[key], val]
    }
  })

  return res
}

export function stringifyQuery (obj: Dictionary<string>): string {
  const res = obj
    ? Object.keys(obj)
      .map(key => {
        const val = obj[key]

        if (val === undefined) {
          return ''
        }

        if (val === null) {
          return encode(key)
        }

        if (Array.isArray(val)) {
          const result = []
          val.forEach(val2 => {
            if (val2 === undefined) {
              return
            }
            if (val2 === null) {
              result.push(encode(key))
            } else {
              result.push(encode(key) + '=' + encode(val2))
            }
          })
          return result.join('&')
        }

        return encode(key) + '=' + encode(val)
      })
      .filter(x => x.length > 0)
      .join('&')
    : null
  return res ? `?${res}` : ''
}
