// 分类与方向的类型清单；运行时常量在 taxonomy.mjs，站点与校验脚本共用同一份。
import { CATEGORIES as _CATEGORIES, TOPICS as _TOPICS } from './taxonomy.mjs';

export const CATEGORIES = _CATEGORIES;
export const TOPICS = _TOPICS;

export type Category = (typeof CATEGORIES)[number];
export type Topic = (typeof TOPICS)[number];
