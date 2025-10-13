export const NAME_SHIM =
  'globalThis.__name||(globalThis.__name=(fn,name)=>{try{Object.defineProperty(fn,"name",{value:name,configurable:true});}catch{}return fn;});';
