import { expect } from "chai";
import { repeat, RepeatDirective, RepeatBehavior } from "./repeat.js";
import { child, html } from "./template.js";
import { ExecutionContext, observable } from "../observation/observable.js";
import { toHTML } from "../__test__/helpers.js";
import { Updates } from "../observation/update-queue.js";

describe("The repeat", () => {
    function createLocation() {
        const parent = document.createElement("div");
        const location = document.createComment("");
        const nodeId = 'r';
        const targets = { [nodeId]: location };

        parent.appendChild(location);

        return { parent, targets, nodeId };
    }

    context("template function", () => {
        it("returns a RepeatDirective", () => {
            const directive = repeat(
                () => [],
                html`test`
            );
            expect(directive).to.be.instanceOf(RepeatDirective);
        });
    });

    context("directive", () => {
        it("creates a RepeatBehavior", () => {
            const { targets, nodeId } = createLocation();
            const directive = repeat(
                () => [],
                html`test`
            ) as RepeatDirective;
            directive.nodeId = nodeId;

            const behavior = directive.createBehavior(targets);

            expect(behavior).to.be.instanceOf(RepeatBehavior);
        });
    });

    context("behavior", () => {
        const itemTemplate = html<Item>`${x => x.name}`;
        const altItemTemplate = html<Item>`*${x => x.name}`;
        const oneThroughTen = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        const zeroThroughTen = [0].concat(oneThroughTen);
        const wrappedItemTemplate = html<Item>`<div>${x => x.name}</div>`;

        interface Item {
            name: string;
            items?: Item[];
        }

        function createArray(size: number) {
            const items: { name: string }[] = [];

            for (let i = 0; i < size; ++i) {
                items.push({ name: `item${i + 1}` });
            }

            return items;
        }

        class ViewModel {
            name = "root";
            @observable items: Item[];
            @observable template = itemTemplate;

            constructor(size: number, nested: boolean = false) {
                this.items = createArray(size);

                if (nested) {
                    this.items.forEach(x => (x.items = createArray(size)));
                }
            }
        }

        function createOutput(
            size: number,
            filter: (index: number) => boolean = () => true,
            prefix = "",
            wrapper = input => input
        ) {
            let output = "";

            for (let i = 0; i < size; ++i) {
                if (filter(i)) {
                    output += wrapper(`${prefix}item${i + 1}`);
                }
            }

            return output;
        }

        zeroThroughTen.forEach(size => {
            it(`renders a template for each item in array of size ${size}`, () => {
                const { parent, targets, nodeId } = createLocation();
                const directive = repeat<ViewModel>(
                    x => x.items,
                    itemTemplate
                ) as RepeatDirective;
                directive.nodeId = nodeId;

                const behavior = directive.createBehavior(targets);
                const vm = new ViewModel(size);

                behavior.bind(vm, ExecutionContext.default);

                expect(toHTML(parent)).to.equal(createOutput(size));
            });
        });

        zeroThroughTen.forEach(size => {
            it(`renders empty when an array of size ${size} is replaced with an empty array`, async () => {
                const { parent, targets, nodeId } = createLocation();
                const directive = repeat<ViewModel>(
                    x => x.items,
                    wrappedItemTemplate
                ) as RepeatDirective;
                directive.nodeId = nodeId;
                const behavior = directive.createBehavior(targets);
                const data = new ViewModel(size);

                behavior.bind(data, ExecutionContext.default);

                expect(toHTML(parent)).to.equal(
                    createOutput(size, void 0, void 0, input => `<div>${input}</div>`)
                );

                data.items = [];

                await Updates.next();

                expect(toHTML(parent)).to.equal("");

                data.items = createArray(size);

                await Updates.next();

                expect(toHTML(parent)).to.equal(
                    createOutput(size, void 0, void 0, input => `<div>${input}</div>`)
                );
            });
        });

        zeroThroughTen.forEach(size => {
            it(`updates rendered HTML when a new item is pushed into an array of size ${size}`, async () => {
                const { parent, targets, nodeId } = createLocation();
                const directive = repeat<ViewModel>(
                    x => x.items,
                    itemTemplate
                ) as RepeatDirective;
                directive.nodeId = nodeId;
                const behavior = directive.createBehavior(targets);
                const vm = new ViewModel(size);

                behavior.bind(vm, ExecutionContext.default);
                vm.items.push({ name: "newitem" });

                await Updates.next();

                expect(toHTML(parent)).to.equal(`${createOutput(size)}newitem`);
            });
        });

        oneThroughTen.forEach(size => {
            it(`updates rendered HTML when a single item is spliced from the end of an array of size ${size}`, async () => {
                const { parent, targets, nodeId } = createLocation();
                const directive = repeat<ViewModel>(
                    x => x.items,
                    itemTemplate
                ) as RepeatDirective;
                directive.nodeId = nodeId;
                const behavior = directive.createBehavior(targets);
                const vm = new ViewModel(size);

                behavior.bind(vm, ExecutionContext.default);

                const index = size - 1;
                vm.items.splice(index, 1);

                await Updates.next();

                expect(toHTML(parent)).to.equal(
                    `${createOutput(size, x => x !== index)}`
                );
            });
        });

        oneThroughTen.forEach(size => {
            it(`updates rendered HTML when a single item is spliced from the beginning of an array of size ${size}`, async () => {
                const { parent, targets, nodeId } = createLocation();
                const directive = repeat<ViewModel>(
                    x => x.items,
                    itemTemplate
                ) as RepeatDirective;
                directive.nodeId = nodeId;
                const behavior = directive.createBehavior(targets);
                const vm = new ViewModel(size);

                behavior.bind(vm, ExecutionContext.default);

                vm.items.splice(0, 1);

                await Updates.next();

                expect(toHTML(parent)).to.equal(`${createOutput(size, x => x !== 0)}`);
            });
        });

        oneThroughTen.forEach(size => {
            it(`updates rendered HTML when a single item is replaced from the end of an array of size ${size}`, async () => {
                const { parent, targets, nodeId } = createLocation();
                const directive = repeat<ViewModel>(
                    x => x.items,
                    itemTemplate
                ) as RepeatDirective;
                directive.nodeId = nodeId;
                const behavior = directive.createBehavior(targets);
                const vm = new ViewModel(size);

                behavior.bind(vm, ExecutionContext.default);

                const index = size - 1;
                vm.items.splice(index, 1, { name: "newitem1" }, { name: "newitem2" });

                await Updates.next();

                expect(toHTML(parent)).to.equal(
                    `${createOutput(size, x => x !== index)}newitem1newitem2`
                );
            });
        });

        oneThroughTen.forEach(size => {
            it(`updates rendered HTML when a single item is replaced from the beginning of an array of size ${size}`, async () => {
                const { parent, targets, nodeId } = createLocation();
                const directive = repeat<ViewModel>(
                    x => x.items,
                    itemTemplate
                ) as RepeatDirective;
                directive.nodeId = nodeId;
                const behavior = directive.createBehavior(targets);
                const vm = new ViewModel(size);

                behavior.bind(vm, ExecutionContext.default);

                vm.items.splice(0, 1, { name: "newitem1" }, { name: "newitem2" });

                await Updates.next();

                expect(toHTML(parent)).to.equal(
                    `newitem1newitem2${createOutput(size, x => x !== 0)}`
                );
            });
        });

        oneThroughTen.forEach(size => {
            it(`updates all when the template changes for an array of size ${size}`, async () => {
                const { parent, targets, nodeId } = createLocation();
                const directive = repeat<ViewModel>(
                    x => x.items,
                    x => vm.template
                ) as RepeatDirective;
                directive.nodeId = nodeId;
                const behavior = directive.createBehavior(targets);
                const vm = new ViewModel(size);

                behavior.bind(vm, ExecutionContext.default);

                expect(toHTML(parent)).to.equal(createOutput(size));

                vm.template = altItemTemplate;

                await Updates.next();

                expect(toHTML(parent)).to.equal(createOutput(size, () => true, "*"));
            });
        });

        oneThroughTen.forEach(size => {
            it(`renders grandparent values from nested arrays of size ${size}`, async () => {
                const deepItemTemplate = html<Item>`
                    parent-${x => x.name}${repeat(
                        x => x.items!,
                        child<Item>`child-${x => x.name}root-${(x, c) => c.parentContext.parent.name}`
                    )}
                `;

                const { parent, targets, nodeId } = createLocation();
                const directive = repeat<ViewModel>(
                    x => x.items,
                    deepItemTemplate
                ) as RepeatDirective;
                directive.nodeId = nodeId;
                const behavior = directive.createBehavior(targets);
                const vm = new ViewModel(size, true);

                behavior.bind(vm, ExecutionContext.default);

                const text = toHTML(parent);

                for (let i = 0; i < size; ++i) {
                    const str = `child-item${i + 1}root-root`;
                    expect(text.indexOf(str)).to.not.equal(-1);
                }
            });
        });

        oneThroughTen.forEach(size => {
            it(`handles back to back shift operations for arrays of size ${size}`, async () => {
                const { parent, targets, nodeId } = createLocation();
                const directive = repeat<ViewModel>(
                    x => x.items,
                    itemTemplate
                ) as RepeatDirective;
                directive.nodeId = nodeId;
                const behavior = directive.createBehavior(targets);
                const vm = new ViewModel(size);

                behavior.bind(vm, ExecutionContext.default);

                vm.items.shift();
                vm.items.unshift({ name: "shift" });

                await Updates.next();

                expect(toHTML(parent)).to.equal(
                    `shift${createOutput(size, index => index !== 0)}`
                );
            });
        });

        zeroThroughTen.forEach(size => {
            it(`updates rendered HTML when a new item is pushed into an array of size ${size} after it has been unbound and rebound`, async () => {
                const { parent, targets, nodeId } = createLocation();
                const directive = repeat<ViewModel>(
                    x => x.items,
                    itemTemplate
                ) as RepeatDirective;
                directive.nodeId = nodeId;
                const behavior = directive.createBehavior(targets);
                const vm = new ViewModel(size);

                behavior.bind(vm, ExecutionContext.default);

                await Updates.next();

                behavior.unbind();

                await Updates.next();

                behavior.bind(vm, ExecutionContext.default);

                await Updates.next();

                vm.items.push({ name: "newitem" });

                await Updates.next();

                expect(toHTML(parent)).to.equal(`${createOutput(size)}newitem`);
            });
        });
    });
});
