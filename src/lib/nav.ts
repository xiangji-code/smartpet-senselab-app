import type { Href } from 'expo-router';

/**
 * 把普通字符串路径转成 expo-router 的 Href。
 *
 * 项目开启了 typedRoutes；新增路由的类型在 `expo start` 时才会重新生成，
 * 这里用一个集中的转换点避免在业务代码里散落类型断言。
 */
export function href(path: string): Href {
  return path as Href;
}
