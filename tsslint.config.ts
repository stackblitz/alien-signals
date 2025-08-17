import { createDiagnosticsPlugin, defineConfig, isCLI } from '@tsslint/config';
import type * as ts from 'typescript';

export default defineConfig({
	plugins: isCLI()
		? [createDiagnosticsPlugin()]
		: [],
	rules: {
		'number-equality'({
			typescript: ts,
			file,
			program,
			report,
		}) {
			const checker = program.getTypeChecker();
			ts.forEachChild(file, function visit(node) {
				if (
					ts.isBinaryExpression(node) &&
					node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
					ts.isNumericLiteral(node.right) &&
					node.right.text === '0'
				) {
					const type = checker.getTypeAtLocation(node.left);
					if (type.flags & ts.TypeFlags.Number) {
						report(
							`Replace "x === 0" with "!x" for numeric variables to clarify boolean usage.`,
							node.getStart(file),
							node.getEnd(),
						).withFix('Use exclamation instead', () => [
							{
								fileName: file.fileName,
								textChanges: [
									{
										newText: `!(${node.left.getText(file)})`,
										span: {
											start: node.getStart(file),
											length: node.getWidth(),
										},
									},
								],
							},
						]);
					}
				}
				ts.forEachChild(node, visit);
			});
		},
		'object-equality'({
			typescript: ts,
			file,
			program,
			report,
		}) {
			const checker = program.getTypeChecker();
			const checkFlags = [ts.TypeFlags.Undefined, ts.TypeFlags.Null];
			ts.forEachChild(file, function visit(node) {
				if (
					ts.isPrefixUnaryExpression(node) &&
					node.operator === ts.SyntaxKind.ExclamationToken
				) {
					const type = checker.getTypeAtLocation(node.operand);
					for (const checkFlag of checkFlags) {
						if (isObjectOrNullableUnion(ts, type, checkFlag)) {
							const flagText =
								checkFlag === ts.TypeFlags.Undefined ? 'undefined' : 'null';
							if (
								ts.isPrefixUnaryExpression(node.parent) &&
								node.parent.operator === ts.SyntaxKind.ExclamationToken
							) {
								report(
									`Do not use "!!" for a variable of type "object | ${flagText}". Replace with "!== ${flagText}" for clarity.`,
									node.parent.getStart(file),
									node.getEnd(),
								).withFix(`Replace with !== ${flagText}`, () => [
									{
										fileName: file.fileName,
										textChanges: [
											{
												newText: `${node.operand.getText(file)} !== ${flagText}`,
												span: {
													start: node.parent.getStart(file),
													length:
														node.getEnd() - node.parent.getStart(file),
												},
											},
										],
									},
								]);
							} else {
								report(
									`Do not use "!" for a variable of type "object | ${flagText}". Replace with "=== ${flagText}" for clarity.`,
									node.getStart(file),
									node.getEnd(),
								).withFix(`Replace with === ${flagText}`, () => [
									{
										fileName: file.fileName,
										textChanges: [
											{
												newText: `${node.operand.getText(file)} === ${flagText}`,
												span: {
													start: node.getStart(file),
													length: node.getWidth(),
												},
											},
										],
									},
								]);
							}
						}
					}
				}
				ts.forEachChild(node, visit);
			});
		},
	},
});

function isObjectOrNullableUnion(
	ts: typeof import('typescript'),
	type: ts.Type,
	nullableFlag: ts.TypeFlags,
) {
	if (!(type.flags & ts.TypeFlags.Union)) return false;
	const unionType = type;
	let hasObject = false;
	let hasNullable = false;
	for (const sub of (unionType as ts.UnionType).types) {
		if (sub.flags & nullableFlag) {
			hasNullable = true;
		} else if (sub.flags & ts.TypeFlags.Object) {
			hasObject = true;
		} else {
			return false;
		}
	}
	return hasObject && hasNullable;
}
