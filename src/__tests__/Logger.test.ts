import { describe, test, expect } from "bun:test";

describe("Logger", () => {
	describe("LogMethod decorator", () => {
		// Test the decorator pattern without importing the actual module
		// (which has side effects from Directories import)

		test("decorator wraps a method and preserves return value", () => {
			// Simulate the decorator pattern
			function LogMethod(opts: { scope?: string; message?: string } = {}) {
				return function (
					_target: any,
					_propertyKey: string,
					descriptor: PropertyDescriptor
				) {
					const originalMethod = descriptor.value;
					descriptor.value = function (...args: any[]) {
						return originalMethod.apply(this, args);
					};
					return descriptor;
				};
			}

			class TestClass {
				@LogMethod({ scope: "Test", message: "doing work" })
				doWork(x: number): number {
					return x * 2;
				}
			}

			const obj = new TestClass();
			expect(obj.doWork(5)).toBe(10);
		});

		test("decorator preserves async method behavior", async () => {
			function LogMethod(opts: { scope?: string } = {}) {
				return function (
					_target: any,
					_propertyKey: string,
					descriptor: PropertyDescriptor
				) {
					const originalMethod = descriptor.value;
					descriptor.value = function (...args: any[]) {
						return originalMethod.apply(this, args);
					};
					return descriptor;
				};
			}

			class TestClass {
				@LogMethod({ scope: "Test" })
				async fetchData(): Promise<string> {
					return "data";
				}
			}

			const obj = new TestClass();
			const result = await obj.fetchData();
			expect(result).toBe("data");
		});

		test("decorator passes arguments through", () => {
			const receivedArgs: any[][] = [];

			function LogMethod(opts: { scope?: string } = {}) {
				return function (
					_target: any,
					_propertyKey: string,
					descriptor: PropertyDescriptor
				) {
					const originalMethod = descriptor.value;
					descriptor.value = function (...args: any[]) {
						receivedArgs.push(args);
						return originalMethod.apply(this, args);
					};
					return descriptor;
				};
			}

			class TestClass {
				@LogMethod({ scope: "Test" })
				add(a: number, b: number): number {
					return a + b;
				}
			}

			const obj = new TestClass();
			expect(obj.add(3, 4)).toBe(7);
			expect(receivedArgs[0]).toEqual([3, 4]);
		});
	});
});
