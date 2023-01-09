/* @flow */
// resolvePath(parsedPath.path, basePath, append || next.append)
// 拼接相对路径
export function resolvePath (
  relative: string,            
  base: string,                
  append?: boolean             //是否直接拼接在路径后方
): string {
  // 绝对路径直接返回
  const firstChar = relative.charAt(0)
  if (firstChar === '/') {
    return relative
  }
  // 相对路径以?或#开头表示为query参数或hash值，直接拼接
  if (firstChar === '?' || firstChar === '#') {
    return base + relative
  }

  const stack = base.split('/')

  // remove trailing segment if:
  // - not appending
  // - appending to trailing slash (last segment is empty)
  // 如果append为false，将数组最后一个空成员清除，表示会替换最后一级路径
  // 如果基础路径最后为/，也需要将数组最后一个空成员清除，表示拼接在后方
  if (!append || !stack[stack.length - 1]) {
    stack.pop()
  }

  // resolve relative path
  // 去掉一个/，并且以/分割相对路径       ???此处为何要去掉第一个/，和绝对路径冲突了
  const segments = relative.replace(/^\//, '').split('/')
  // 此处通过堆栈的形式处理./或../的相对路径，
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    if (segment === '..') {
      stack.pop()
    } else if (segment !== '.') {
      stack.push(segment)
    }
  }

  // ensure leading slash
  // 向开头添加一个空字符，最后拼接成的字符串就会以/开头
  if (stack[0] !== '') {
    stack.unshift('')
  }

  return stack.join('/')
}

// 分解path中的中的query参数和hash值
// 返回一个对象包含：分割好的路径，query参数，hash值
export function parsePath (path: string): {
  path: string;
  query: string;
  hash: string;
} {
  let hash = ''
  let query = ''
  // 从第一个#分割hash值
  const hashIndex = path.indexOf('#')
  if (hashIndex >= 0) {
    hash = path.slice(hashIndex)
    path = path.slice(0, hashIndex)
  }
  // 从第一个?分割query参数
  const queryIndex = path.indexOf('?')
  if (queryIndex >= 0) {
    query = path.slice(queryIndex + 1)
    path = path.slice(0, queryIndex)
  }

  return {
    path,
    query,
    hash
  }
}

// 清除路径中连续的/
export function cleanPath (path: string): string {
  return path.replace(/\/(?:\s*\/)+/g, '/')
}
