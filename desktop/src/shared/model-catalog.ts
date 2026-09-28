import type {Provider} from './api'
export type CatalogModel={id:string;name:string;description:string;hidden:boolean;reasoning:string[];inputModalities:string[];fast:boolean;availability:'listed'|'rejected';reason?:string}
export type ModelCatalog={provider:Provider;models:CatalogModel[];state:'ready'|'stale'|'unavailable';checkedAt?:string;message:string}
