import { IPipelineBehavior } from '../../Abstractions/Behaviors/IPipelineBehavior';

/**
 * Global map storing request type -> handler type associations.
 * Used by LocalBus to resolve handlers.
 */
export const handlersMap = new Map<new (...args: any[]) => any, new (...args: any[]) => any>();

/**
 * Global set storing pipeline behavior types.
 * Used by LocalBus to execute behaviors in the pipeline.
 */
export const behaviorsMap = new Set<new (...args: any[]) => IPipelineBehavior<any, any>>();
