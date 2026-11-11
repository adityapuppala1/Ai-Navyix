export type CriterionState='MET'|'UNMET'|'UNKNOWN'|'STALE'|'NOT_APPLICABLE'|'EXCEPTION_ACCEPTED';
export type ReadinessStatus='READY'|'BLOCKED'|'INSUFFICIENT_EVIDENCE'|'READY_WITH_CONDITIONS';
export interface Context{targetDigest:string;environmentId:string;policyVersion:string;now:string}
export interface Criterion{id:string;mandatory:boolean;state:CriterionState;exception?:{authorized:boolean;expiresAt:string;targetDigest:string;policyVersion:string;environmentId:string}}
export declare const CRITERION_STATES:Readonly<Record<string,CriterionState>>;
export declare function evaluateReadiness(criteria:Criterion[],context:Context):Readonly<{status:ReadinessStatus;targetDigest:string;environmentId:string;policyVersion:string;evaluatedAt:string;results:Array<{id:string;mandatory:boolean;state:CriterionState;originalState:CriterionState;acceptedException:boolean}>}>;
