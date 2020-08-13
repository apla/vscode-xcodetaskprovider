// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');

const path = require('path');

const fs = require('fs').promises;

const {exec} = require('child_process');

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "xcodeprovider" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with  registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('xcodeprovider.helloWorld', function () {
		// The code you place here will be executed every time your command is executed

		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World from XcodeProvider!');

		// vscode.workspace.updateWorkspaceFolders(0, 0, )
	});

	context.subscriptions.push(disposable);

	const workspaceRoot = vscode.workspace.rootPath;
	if (!workspaceRoot) {
		return;
	}

	const xcodeProvider = new XcodeProvider (workspaceRoot);
	
	vscode.tasks.registerTaskProvider ('xcode', xcodeProvider);

	vscode.debug.registerDebugConfigurationProvider(
		'xcode',
		xcodeProvider,
		vscode.DebugConfigurationProviderTriggerKind.Dynamic
	);
}
exports.activate = activate;

// this method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}

/** @type {vscode.OutputChannel} */
let _channel;
/**
 * Returns existing or returns newly created output channel
 * @returns {vscode.OutputChannel}
 */
function getOutputChannel() {
	if (!_channel) {
		_channel = vscode.window.createOutputChannel('Xcode Auto Detection');
	}
	return _channel;
}

// @ implements {vscode.TaskProvider}
/**
 * Task provider for Xcode project (.xcodeproj) and workspace (.xcworkspace) folders
 * @class
 * 
 */
class XcodeProvider {
	static XcodeType = 'xcode';

	/**
	 * Setup watcher for Xcode folders
	 * @param {String} workspaceRoot workspace root
	 */
	constructor (workspaceRoot) {
		const pattern = path.join(workspaceRoot, '**/*.{xcworkspace,xcodeproj}');
		const fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
		fileWatcher.onDidChange(() => this.xcodebuildPromise = undefined);
		fileWatcher.onDidCreate(() => this.xcodebuildPromise = undefined);
		fileWatcher.onDidDelete(() => this.xcodebuildPromise = undefined);
	}

	/**
	 * Provide tasks from xcodebuild command
	 * @returns {Promise<vscode.Task[]>}
	 */
	async provideTasks() {
		if (!this.xcodebuildPromise) {
			this.xcodebuildPromise = gettingXcodebuildInfo();
		}

		const {tasks} = await this.xcodebuildPromise;

		return tasks;
	}

	/**
	 * @property {vscode.WorkspaceFolder | undefined} [folder]
     * @property {vscode.Task} task
     * @property {vscode.CancellationToken} [token]
	 * @returns {Promise<vscode.Task>}
	 */
	async resolveTask(folder, task, token) {
		return task;
	}

	// https://code.visualstudio.com/api/extension-guides/debugger-extension

	/*
	"name": "clang - Build and debug active file",
            "type": "cppdbg",
            "request": "launch",
            "program": "${fileDirname}/${fileBasenameNoExtension}.out",
            "args": [],
            "stopAtEntry": false,
            "cwd": "${workspaceFolder}",
            "environment": [],
            "externalConsole": true,
            "MIMode": "lldb",
            // "preLaunchTask": "clang build active file"
            "preLaunchTask": "clangBuild",
	*/

	/**
	 * @returns {Promise<vscode.DebugConfiguration[]>}
	 */
	async provideDebugConfigurations() {
		if (!this.xcodebuildPromise) {
			this.xcodebuildPromise = gettingXcodebuildInfo();
		}

		const {debugConfigurations} = await this.xcodebuildPromise;

		return debugConfigurations;
	}

	/**
	 * @property {vscode.WorkspaceFolder | undefined} [folder]
     * @property {vscode.DebugConfiguration} debugConfiguration
     * @property {vscode.CancellationToken} [token]
	 * @returns {Promise<vscode.DebugConfiguration>}
	 */
	async resolveDebugConfiguration (folder, debugConfiguration, token) {
		return debugConfiguration
	}

}

/**
 * 
 * @param {vscode.WorkspaceFolder} workspaceFolder 
 * @param {String} xcfolder xcode project/workspace directory
 * @param {Object} xcodebuild xcodebuild object
 * @param {String} xcodebuild.name xcodebuild project name
 * @param {String[]} xcodebuild.configurations xcodebuild project configuration names
 * @param {String[]} xcodebuild.schemes xcodebuild project configuration schemes
 * @param {String[]} xcodebuild.targets xcodebuild project configuration targets
 * @returns {vscode.Task[]}
 */
function createTasksFromJson (workspaceFolder, xcfolder, {name, configurations = [''], schemes, targets = []}) {

	const taskList = [];

	let folderType = 'project';
	let isWorkspace = false;
	if (xcfolder.match(/([^\/]+)\.xcworkspace$/)) {
		folderType = 'workspace';
		isWorkspace = true;
	}

	schemes.forEach(schemeName => {

		configurations.forEach(configurationName => {

			const taskName = schemeName + (
				isWorkspace ? '' : ' (' + configurationName + ')'
			) + ` - ${name} ${folderType}`;

			const kind = {
				type: 'xcode',
				task: taskName,
				problemMatcher: [
					"$xcodebuild"
				]
			};

			let cmdLine = `xcodebuild -${folderType} ${xcfolder} -scheme ${schemeName}`;
			if (!isWorkspace)
				cmdLine += ` -configuration ${configurationName}`;

			// xcodebuild generates clang -fmessage-length= parameter with terminal column count
			// took a few hours just to pass that param
			// forking xcode
			cmdLine += ' | tee';

			const task = new vscode.Task(
				kind, workspaceFolder, taskName, `Xcode`,
				new vscode.ShellExecution(cmdLine)
			);

			/*
			import { languages, Diagnostic, DiagnosticSeverity } from 'vscode';

... 

let diagnosticCollection = languages.createDiagnosticCollection("stuff");
let diagnostics : Diagnostic[] = [];

...

diagnostics.push(new Diagnostic(range, message, DiagnosticSeverity.Warning));

diagnosticCollection.set(document.uri, diagnostics);
			*/

			/*
			if (isBuildTask(lowerCaseLine)) {
				task.group = vscode.TaskGroup.Build;
			} else if (isTestTask(lowerCaseLine)) {
				task.group = vscode.TaskGroup.Test;
			}
			*/

			task.group = vscode.TaskGroup.Build;

			taskList.push(task);
		});
	});

	return taskList;
}

/**
 * @typedef XcodebuildInfo
 * @property {vscode.Task[]} tasks
 * @property {vscode.DebugConfiguration[]} debugConfigurations
 */

/**
 * @returns {Promise<XcodebuildInfo>}
 */
async function gettingXcodebuildInfo() {
	const workspaceFolders = vscode.workspace.workspaceFolders;
	
	/** @type {vscode.Task[]} */
	const tasks = [];
	/** @type {vscode.DebugConfiguration[]} */
	const debugConfigurations = [];
	
	let foldersToProcess = 0;
	let folderCb;
	
	if (!workspaceFolders || workspaceFolders.length === 0) {
		return {
			tasks,
			debugConfigurations
		};
	}

	const xcodeFolders = [];

	for (const workspaceFolder of workspaceFolders) {
		const folderString = workspaceFolder.uri.fsPath;

		// of course, search for folders are not supported
		const filesFound = await vscode.workspace.findFiles('**/*.{xcworkspacedata,pbxproj}');

		const subFolders = filesFound.map (
			f => vscode.workspace.asRelativePath(path.dirname (f.fsPath), false)
		).filter(
			f => !f.match (/\.xcodeproj\/project\.xcworkspace$/)
		).filter(
			// filter Carthage subprojects
			f => !f.match (/\bCarthage\b/)
		);

		// const subFolders = await fs.readdir(folderString);
		for (const relativeFolderName of subFolders) {
			if (!relativeFolderName) continue;
			if (relativeFolderName.match(/\.xcodeproj$/)) {
				xcodeFolders.push({workspaceFolder, folderType: 'project', relativeFolderName});
			} else if (relativeFolderName.match(/\.xcworkspace$/)) {
				xcodeFolders.push({workspaceFolder, folderType: 'workspace', relativeFolderName});
			}
		}
	}

	for (const folder of xcodeFolders) {

		const {workspaceFolder, folderType, relativeFolderName} = folder;

		const absFolderPath = path.join(workspaceFolder.uri.fsPath, relativeFolderName);

		const basename = path.basename(absFolderPath);

		let commandLine;
		commandLine = `xcodebuild -${folderType} ${basename} -list -json`;

		// https://developer.apple.com/library/archive/technotes/tn2339/_index.html
		// TODO: tasks: tests, destinations; build and debug: build settings
		// -showTestPlans -showdestinations
		// unfortunately, json output not available
		/*
		Available destinations for the "X" scheme:
		{ platform:macOS, arch:x86_64, id:4E456785-2A47-5DA9-B975-2C77D7204207 }
		*/
		// -showBuildSettings
		// https://github.com/microsoft/vscode/issues/88230

		// https://medium.com/xcblog/xcodebuild-deploy-ios-app-from-command-line-c6defff0d8b8

		foldersToProcess ++;
		exec(commandLine, { cwd: path.dirname(absFolderPath) }, (error, stdout, stderr) => {
			foldersToProcess --;
			if (error) {
				getOutputChannel().appendLine(`While running \`${commandLine}\` in \`${path.dirname(absFolderPath)}\`:`);
				getOutputChannel().appendLine(stderr);
				getOutputChannel().show(true);

				return folderCb && folderCb ();
			}
			let json;
			try {
				json = JSON.parse(stdout);
				// parse tasks
				const projectTasks = createTasksFromJson (workspaceFolder, absFolderPath, json.project || json.workspace);
				projectTasks.forEach(task => tasks.push(task));
			} catch (error) {
				getOutputChannel().appendLine(`While running \`${commandLine}\` in \`${path.dirname(absFolderPath)}\`:`);
				getOutputChannel().appendLine(error);
				getOutputChannel().show(true);
			}
			return folderCb && folderCb ();
		});
	}

	const result = new Promise ((resolve, reject) => {
		folderCb = function () {
			if (!foldersToProcess) {
				resolve({tasks, debugConfigurations});
			}
		}
		folderCb();
	});

	return result;
}