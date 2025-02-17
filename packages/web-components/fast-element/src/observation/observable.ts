import {
    Disposable,
    isFunction,
    isString,
    KernelServiceId,
    Message,
} from "../interfaces.js";
import { FAST } from "../platform.js";
import { Updates } from "./update-queue.js";
import { PropertyChangeNotifier, SubscriberSet } from "./notifier.js";
import type { Notifier, Subscriber } from "./notifier.js";

/**
 * Represents a getter/setter property accessor on an object.
 * @public
 */
export interface Accessor {
    /**
     * The name of the property.
     */
    name: string;

    /**
     * Gets the value of the property on the source object.
     * @param source - The source object to access.
     */
    getValue(source: any): any;

    /**
     * Sets the value of the property on the source object.
     * @param source - The source object to access.
     * @param value - The value to set the property to.
     */
    setValue(source: any, value: any): void;
}

/**
 * The signature of an arrow function capable of being evaluated
 * as part of a template binding update.
 * @public
 */
export type Binding<
    TSource = any,
    TReturn = any,
    TContext extends ExecutionContext = ExecutionContext
> = (source: TSource, context: TContext) => TReturn;

/**
 * A record of observable property access.
 * @public
 */
export interface ObservationRecord {
    /**
     * The source object with an observable property that was accessed.
     */
    propertySource: any;

    /**
     * The name of the observable property on {@link ObservationRecord.propertySource} that was accessed.
     */
    propertyName: string;
}

interface SubscriptionRecord extends ObservationRecord {
    notifier: Notifier;
    next: SubscriptionRecord | undefined;
}

/**
 * Enables evaluation of and subscription to a binding.
 * @public
 */
export interface BindingObserver<TSource = any, TReturn = any, TParent = any>
    extends Notifier,
        Disposable {
    /**
     * Begins observing the binding for the source and returns the current value.
     * @param source - The source that the binding is based on.
     * @param context - The execution context to execute the binding within.
     * @returns The value of the binding.
     */
    observe(source: TSource, context?: ExecutionContext<TParent>): TReturn;

    /**
     * Gets {@link ObservationRecord|ObservationRecords} that the {@link BindingObserver}
     * is observing.
     */
    records(): IterableIterator<ObservationRecord>;

    /**
     * Sets the update mode used by the observer.
     * @param isAsync - Indicates whether updates should be asynchronous.
     * @remarks
     * By default, the update mode is asynchronous, since that provides the best
     * performance for template rendering scenarios. Passing false to setMode will
     * instead cause the observer to notify subscribers immediately when changes occur.
     */
    setMode(isAsync: boolean): void;
}

/**
 * Common Observable APIs.
 * @public
 */
export const Observable = FAST.getById(KernelServiceId.observable, () => {
    const queueUpdate = Updates.enqueue;
    const volatileRegex = /(:|&&|\|\||if)/;
    const notifierLookup = new WeakMap<any, Notifier>();
    const accessorLookup = new WeakMap<any, Accessor[]>();
    let watcher: BindingObserverImplementation | undefined = void 0;
    let createArrayObserver = (array: any[]): Notifier => {
        throw FAST.error(Message.needsArrayObservation);
    };

    function getNotifier<T extends Notifier = Notifier>(source: any): T {
        let found = source.$fastController ?? notifierLookup.get(source);

        if (found === void 0) {
            Array.isArray(source)
                ? (found = createArrayObserver(source))
                : notifierLookup.set(
                      source,
                      (found = new PropertyChangeNotifier(source))
                  );
        }

        return found;
    }

    function getAccessors(target: {}): Accessor[] {
        let accessors = accessorLookup.get(target);

        if (accessors === void 0) {
            let currentTarget = Reflect.getPrototypeOf(target);

            while (accessors === void 0 && currentTarget !== null) {
                accessors = accessorLookup.get(currentTarget);
                currentTarget = Reflect.getPrototypeOf(currentTarget);
            }

            accessors = accessors === void 0 ? [] : accessors.slice(0);

            accessorLookup.set(target, accessors);
        }

        return accessors;
    }

    class DefaultObservableAccessor implements Accessor {
        private field: string;
        private callback: string;

        constructor(public name: string) {
            this.field = `_${name}`;
            this.callback = `${name}Changed`;
        }

        getValue(source: any): any {
            if (watcher !== void 0) {
                watcher.watch(source, this.name);
            }

            return source[this.field];
        }

        setValue(source: any, newValue: any): void {
            const field = this.field;
            const oldValue = source[field];

            if (oldValue !== newValue) {
                source[field] = newValue;

                const callback = source[this.callback];

                if (isFunction(callback)) {
                    callback.call(source, oldValue, newValue);
                }

                getNotifier(source).notify(this.name);
            }
        }
    }

    class BindingObserverImplementation<TSource = any, TReturn = any>
        extends SubscriberSet
        implements BindingObserver<TSource, TReturn> {
        public needsRefresh: boolean = true;
        private needsQueue: boolean = true;
        private isAsync = true;

        private first: SubscriptionRecord = this as any;
        private last: SubscriptionRecord | null = null;
        private propertySource: any = void 0;
        private propertyName: string | undefined = void 0;
        private notifier: Notifier | undefined = void 0;
        private next: SubscriptionRecord | undefined = void 0;

        constructor(
            private binding: Binding<TSource, TReturn>,
            initialSubscriber?: Subscriber,
            private isVolatileBinding: boolean = false
        ) {
            super(binding, initialSubscriber);
        }

        public setMode(isAsync: boolean): void {
            this.isAsync = this.needsQueue = isAsync;
        }

        public observe(source: TSource, context?: ExecutionContext): TReturn {
            if (this.needsRefresh && this.last !== null) {
                this.dispose();
            }

            const previousWatcher = watcher;
            watcher = this.needsRefresh ? this : void 0;
            this.needsRefresh = this.isVolatileBinding;
            const result = this.binding(source, context ?? ExecutionContext.default);
            watcher = previousWatcher;

            return result;
        }

        public dispose(): void {
            if (this.last !== null) {
                let current = this.first;

                while (current !== void 0) {
                    current.notifier.unsubscribe(this, current.propertyName);
                    current = current.next!;
                }

                this.last = null;
                this.needsRefresh = this.needsQueue = this.isAsync;
            }
        }

        public watch(propertySource: unknown, propertyName: string): void {
            const prev = this.last;
            const notifier = getNotifier(propertySource);
            const current: SubscriptionRecord = prev === null ? this.first : ({} as any);

            current.propertySource = propertySource;
            current.propertyName = propertyName;
            current.notifier = notifier;

            notifier.subscribe(this, propertyName);

            if (prev !== null) {
                if (!this.needsRefresh) {
                    // Declaring the variable prior to assignment below circumvents
                    // a bug in Angular's optimization process causing infinite recursion
                    // of this watch() method. Details https://github.com/microsoft/fast/issues/4969
                    let prevValue;
                    watcher = void 0;
                    /* eslint-disable-next-line */
                    prevValue = prev.propertySource[prev.propertyName];
                    /* eslint-disable-next-line */
                    watcher = this;

                    if (propertySource === prevValue) {
                        this.needsRefresh = true;
                    }
                }

                prev.next = current;
            }

            this.last = current!;
        }

        handleChange(): void {
            if (this.needsQueue) {
                this.needsQueue = false;
                queueUpdate(this);
            } else if (!this.isAsync) {
                this.call();
            }
        }

        call(): void {
            if (this.last !== null) {
                this.needsQueue = this.isAsync;
                this.notify(this);
            }
        }

        public *records(): IterableIterator<ObservationRecord> {
            let next = this.first;

            while (next !== void 0) {
                yield next;
                next = next.next!;
            }
        }
    }

    return Object.freeze({
        /**
         * @internal
         * @param factory - The factory used to create array observers.
         */
        setArrayObserverFactory(factory: (collection: any[]) => Notifier): void {
            createArrayObserver = factory;
        },

        /**
         * Gets a notifier for an object or Array.
         * @param source - The object or Array to get the notifier for.
         */
        getNotifier,

        /**
         * Records a property change for a source object.
         * @param source - The object to record the change against.
         * @param propertyName - The property to track as changed.
         */
        track(source: unknown, propertyName: string): void {
            watcher && watcher.watch(source, propertyName);
        },

        /**
         * Notifies watchers that the currently executing property getter or function is volatile
         * with respect to its observable dependencies.
         */
        trackVolatile(): void {
            watcher && (watcher.needsRefresh = true);
        },

        /**
         * Notifies subscribers of a source object of changes.
         * @param source - the object to notify of changes.
         * @param args - The change args to pass to subscribers.
         */
        notify(source: unknown, args: any): void {
            /* eslint-disable-next-line @typescript-eslint/no-use-before-define */
            getNotifier(source).notify(args);
        },

        /**
         * Defines an observable property on an object or prototype.
         * @param target - The target object to define the observable on.
         * @param nameOrAccessor - The name of the property to define as observable;
         * or a custom accessor that specifies the property name and accessor implementation.
         */
        defineProperty(target: {}, nameOrAccessor: string | Accessor): void {
            if (isString(nameOrAccessor)) {
                nameOrAccessor = new DefaultObservableAccessor(nameOrAccessor);
            }

            getAccessors(target).push(nameOrAccessor);

            Reflect.defineProperty(target, nameOrAccessor.name, {
                enumerable: true,
                get(this: any) {
                    return (nameOrAccessor as Accessor).getValue(this);
                },
                set(this: any, newValue: any) {
                    (nameOrAccessor as Accessor).setValue(this, newValue);
                },
            });
        },

        /**
         * Finds all the observable accessors defined on the target,
         * including its prototype chain.
         * @param target - The target object to search for accessor on.
         */
        getAccessors,

        /**
         * Creates a {@link BindingObserver} that can watch the
         * provided {@link Binding} for changes.
         * @param binding - The binding to observe.
         * @param initialSubscriber - An initial subscriber to changes in the binding value.
         * @param isVolatileBinding - Indicates whether the binding's dependency list must be re-evaluated on every value evaluation.
         */
        binding<TSource = any, TReturn = any>(
            binding: Binding<TSource, TReturn>,
            initialSubscriber?: Subscriber,
            isVolatileBinding: boolean = this.isVolatileBinding(binding)
        ): BindingObserver<TSource, TReturn> {
            return new BindingObserverImplementation(
                binding,
                initialSubscriber,
                isVolatileBinding
            );
        },

        /**
         * Determines whether a binding expression is volatile and needs to have its dependency list re-evaluated
         * on every evaluation of the value.
         * @param binding - The binding to inspect.
         */
        isVolatileBinding<TSource = any, TReturn = any>(
            binding: Binding<TSource, TReturn>
        ): boolean {
            return volatileRegex.test(binding.toString());
        },
    });
});

/**
 * Decorator: Defines an observable property on the target.
 * @param target - The target to define the observable on.
 * @param nameOrAccessor - The property name or accessor to define the observable as.
 * @public
 */
export function observable(target: {}, nameOrAccessor: string | Accessor): void {
    Observable.defineProperty(target, nameOrAccessor);
}

/**
 * Decorator: Marks a property getter as having volatile observable dependencies.
 * @param target - The target that the property is defined on.
 * @param name - The property name.
 * @param name - The existing descriptor.
 * @public
 */
export function volatile(
    target: {},
    name: string | Accessor,
    descriptor: PropertyDescriptor
): PropertyDescriptor {
    return Object.assign({}, descriptor, {
        get(this: any) {
            Observable.trackVolatile();
            return descriptor.get!.apply(this);
        },
    });
}

const contextEvent = FAST.getById(KernelServiceId.contextEvent, () => {
    let current: Event | null = null;

    return {
        get() {
            return current;
        },
        set(event: Event | null) {
            current = event;
        },
    };
});

/**
 * Provides additional contextual information available to behaviors and expressions.
 * @public
 */
export interface RootContext {
    /**
     * The current event within an event handler.
     */
    readonly event: Event;

    /**
     * Returns the typed event detail of a custom event.
     */
    eventDetail<TDetail = any>(): TDetail;

    /**
     * Returns the typed event target of the event.
     */
    eventTarget<TTarget extends EventTarget = EventTarget>(): TTarget;

    /**
     * Creates a new execution context descendent from the current context.
     * @param source - The source for the context if different than the parent.
     * @returns A child execution context.
     */
    createChildContext<TParentSource>(source: TParentSource): ChildContext<TParentSource>;
}

/**
 * Provides additional contextual information when inside a child template.
 * @public
 */
export interface ChildContext<TParentSource = any> extends RootContext {
    /**
     * The parent data source within a nested context.
     */
    readonly parent: TParentSource;

    /**
     * The parent execution context when in nested context scenarios.
     */
    readonly parentContext: ChildContext<TParentSource>;

    /**
     * Creates a new execution context descent suitable for use in list rendering.
     * @param item - The list item to serve as the source.
     * @param index - The index of the item in the list.
     * @param length - The length of the list.
     */
    createItemContext(index: number, length: number): ItemContext<TParentSource>;
}

/**
 * Provides additional contextual information when inside a repeat item template.s
 * @public
 */
export interface ItemContext<TParentSource = any> extends ChildContext<TParentSource> {
    /**
     * The index of the current item within a repeat context.
     */
    readonly index: number;

    /**
     * The length of the current collection within a repeat context.
     */
    readonly length: number;

    /**
     * Indicates whether the current item within a repeat context
     * has an even index.
     */
    readonly isEven: boolean;

    /**
     * Indicates whether the current item within a repeat context
     * has an odd index.
     */
    readonly isOdd: boolean;

    /**
     * Indicates whether the current item within a repeat context
     * is the first item in the collection.
     */
    readonly isFirst: boolean;

    /**
     * Indicates whether the current item within a repeat context
     * is somewhere in the middle of the collection.
     */
    readonly isInMiddle: boolean;

    /**
     * Indicates whether the current item within a repeat context
     * is the last item in the collection.
     */
    readonly isLast: boolean;

    /**
     * Updates the position/size on a context associated with a list item.
     * @param index - The new index of the item.
     * @param length - The new length of the list.
     */
    updatePosition(index: number, length: number): void;
}

class DefaultExecutionContext implements RootContext, ChildContext, ItemContext {
    public index: number = 0;
    public length: number = 0;
    public readonly parent: any;
    public readonly parentContext: ChildContext<any>;

    constructor(parentSource: any = null, parentContext: ExecutionContext | null = null) {
        this.parent = parentSource;
        this.parentContext = parentContext as any;
    }

    get event(): Event {
        return contextEvent.get()!;
    }

    get isEven(): boolean {
        return this.index % 2 === 0;
    }

    get isOdd(): boolean {
        return this.index % 2 !== 0;
    }

    get isFirst(): boolean {
        return this.index === 0;
    }

    get isInMiddle(): boolean {
        return !this.isFirst && !this.isLast;
    }

    get isLast(): boolean {
        return this.index === this.length - 1;
    }

    eventDetail<TDetail>(): TDetail {
        return (this.event as CustomEvent<TDetail>).detail;
    }

    eventTarget<TTarget extends EventTarget>(): TTarget {
        return this.event.target! as TTarget;
    }

    updatePosition(index: number, length: number): void {
        this.index = index;
        this.length = length;
    }

    createChildContext<TParentSource>(
        parentSource: TParentSource
    ): ChildContext<TParentSource> {
        return new DefaultExecutionContext(parentSource, this);
    }

    createItemContext(index: number, length: number): ItemContext {
        const childContext = Object.create(this);
        childContext.index = index;
        childContext.length = length;
        return childContext;
    }
}

Observable.defineProperty(DefaultExecutionContext.prototype, "index");
Observable.defineProperty(DefaultExecutionContext.prototype, "length");

/**
 * The common execution context APIs.
 * @public
 */
export const ExecutionContext = Object.freeze({
    default: new DefaultExecutionContext() as RootContext,

    /**
     * Sets the event for the current execution context.
     * @param event - The event to set.
     * @internal
     */
    setEvent(event: Event | null): void {
        contextEvent.set(event);
    },

    /**
     * Creates a new root execution context.
     * @returns A new execution context.
     */
    create(): RootContext {
        return new DefaultExecutionContext();
    },
});

/**
 * Represents some sort of execution context.
 * @public
 */
export type ExecutionContext<TParentSource = any> =
    | RootContext
    | ChildContext<TParentSource>
    | ItemContext<TParentSource>;
