export function applyDecoratedDescriptor(target: any, property: string | symbol, decorators: any[], descriptor: any, context: unknown) {
  const desc: Record<string, any> = {};

  Object.keys(descriptor).forEach((key) => {
    desc[key] = descriptor[key];
  });

  desc.enumerable = !!desc.enumerable;
  desc.configurable = !!desc.configurable;

  if ('value' in desc || desc.initializer) {
    desc.writable = true;
  }

  const finalDescriptor = decorators.slice().reverse().reduce((acc, decorator) => {
    return decorator ? decorator(target, property, acc) || acc : acc;
  }, desc);

  const hasAccessor = Object.prototype.hasOwnProperty.call(finalDescriptor, 'get') ||
    Object.prototype.hasOwnProperty.call(finalDescriptor, 'set');

  if (context && finalDescriptor.initializer !== void 0 && !hasAccessor) {
    finalDescriptor.value = finalDescriptor.initializer ? finalDescriptor.initializer.call(context) : void 0;
    finalDescriptor.initializer = undefined;
  }

  if (hasAccessor) {
    delete finalDescriptor.writable;
    delete finalDescriptor.initializer;
    delete finalDescriptor.value;
  }

  if (finalDescriptor.initializer === void 0) {
    Object.defineProperty(target, property, finalDescriptor);
    return null;
  }

  return finalDescriptor;
}