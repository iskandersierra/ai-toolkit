import * as vscode from 'vscode';
import { registerAnnotationFeature } from './annotations/bootstrap/registerAnnotationFeature';

export function activate(context: vscode.ExtensionContext) {
	registerAnnotationFeature(context);
}

export function deactivate() {}
