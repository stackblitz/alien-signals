# Changelog

## 0.2.0

- New interfaces: `ISignal`, `IWritableSignal`
- Removed API: `Dependency.setPropagationMode`
- `System.startBatch`: move to top level exports
- `System.endBatch`: move to top level exports
- Correctly schedule computed side effects

## 0.1.0

- Correctly schedule inner effect callbacks

## 0.0.1

- Add basic APIs: `signal()`, `computed()`, `effect()`, `effectScope()`, `System.startBatch()`, `System.endBatch()`
