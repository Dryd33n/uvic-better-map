export * from './uvic-campus';
import type { Campus } from './uvic-campus';
export declare function fileLoader(dir: string): (path: string) => Promise<any>;
export declare function openCampusFromDir(dir?: string): Promise<Campus>;
