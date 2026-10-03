//! Small declarative build coordinator. Ecosystem tools still own their
//! builds and artifact installation; we only sequence named configurations.
use crate::types::{ConfigEntry, CraiddSolution, OrderStep};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::io::{BufRead, BufReader};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrderRequest {
    pub solution_path: String,
    pub configuration: String,
    pub profile: Option<String>,
}

#[derive(Default)]
pub struct OrderJob {
    cancelled: AtomicBool,
    pgid: AtomicI32,
}

impl OrderJob {
    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        let pgid = self.pgid.load(Ordering::SeqCst);
        if pgid > 0 {
            unsafe {
                libc::killpg(pgid, libc::SIGTERM);
            }
        }
    }
    fn check(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::SeqCst) {
            Err("Build order cancelled".into())
        } else {
            Ok(())
        }
    }
}

#[derive(Default)]
pub struct OrderManager(Mutex<HashMap<String, Arc<OrderJob>>>);
impl Drop for OrderManager {
    fn drop(&mut self) {
        if let Ok(jobs) = self.0.lock() {
            for job in jobs.values() {
                job.cancel();
            }
        }
    }
}

pub fn cancel(app: &AppHandle, label: &str) -> bool {
    if let Some(state) = app.try_state::<OrderManager>() {
        if let Ok(jobs) = state.0.lock() {
            if let Some(job) = jobs.get(label) {
                job.cancel();
                return true;
            }
        }
    }
    false
}

pub fn has_active_order(app: &AppHandle, label: &str) -> bool {
    app.try_state::<OrderManager>().is_some_and(|state|
        state.0.lock().is_ok_and(|jobs| jobs.contains_key(label)))
}

fn load(request: &OrderRequest) -> Result<CraiddSolution, String> {
    let file = Path::new(&request.solution_path)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let root = file.parent().ok_or("Solution has no directory")?;
    super::solution::load_solution_named(
        root.to_string_lossy().into_owned(),
        file.file_name()
            .ok_or("Solution has no filename")?
            .to_string_lossy()
            .into_owned(),
    )?
    .map(|loaded| loaded.solution)
    .ok_or_else(|| "Solution is missing".into())
}

fn configuration<'a>(solution: &'a CraiddSolution, name: &str) -> Result<&'a ConfigEntry, String> {
    solution
        .configs
        .iter()
        .find(|config| config.name == name)
        .ok_or_else(|| format!("Build order references missing saved configuration: {name}"))
}

/// Expand and validate the whole preparation before spawning any process.
pub fn plan(solution: &CraiddSolution, name: &str) -> Result<Vec<OrderStep>, String> {
    fn expand(
        solution: &CraiddSolution,
        name: &str,
        include_build: bool,
        visiting: &mut HashSet<String>,
        result: &mut Vec<OrderStep>,
    ) -> Result<(), String> {
        if !visiting.insert(name.into()) {
            return Err(format!("Build order cycle at {name}"));
        }
        if visiting.len() > 32 || result.len() > 128 {
            return Err("Build order is too large".into());
        }
        let config = configuration(solution, name)?;
        if include_build && config.kind != "build" {
            return Err(format!("{name} is not a build configuration"));
        }
        if let Some(order) = &config.order {
            if order.before.is_some() && !order.steps.is_empty() {
                return Err(format!(
                    "{name}: choose a preparation reference or inline steps, not both"
                ));
            }
            if let Some(before) = &order.before {
                expand(solution, before, true, visiting, result)?;
            }
            for step in &order.steps {
                match step {
                    OrderStep::Build { configuration } => {
                        expand(solution, configuration, true, visiting, result)?
                    }
                    OrderStep::Install {
                        configuration: source,
                        destination,
                    } => {
                        let source_config = configuration(solution, source)?;
                        let destination_config = configuration(solution, destination)?;
                        if source_config.method.as_deref() != Some("cmake")
                            || destination_config.method.as_deref() != Some("dotnet")
                        {
                            return Err("Artifact installation currently needs a CMake build and a .NET build destination".into());
                        }
                        for required in [source, destination] {
                            if !result.iter().any(|step| matches!(step, OrderStep::Build { configuration } if configuration == required)) {
                                return Err(format!("Build {required} before installing its artifacts"));
                            }
                        }
                        result.push(step.clone());
                    }
                }
            }
        }
        if include_build && config.method.as_deref() != Some("plan") {
            if !matches!(config.method.as_deref(), Some("dotnet" | "cmake" | "cargo")) {
                return Err(format!(
                    "{name}: ordered builds support .NET, CMake, and Cargo; no shell scripts"
                ));
            }
            result.push(OrderStep::Build {
                configuration: name.into(),
            });
        }
        if config.method.as_deref() == Some("plan")
            && config
                .order
                .as_ref()
                .is_none_or(|order| order.steps.is_empty() && order.before.is_none())
        {
            return Err(format!("{name} has no build steps"));
        }
        visiting.remove(name);
        Ok(())
    }
    let mut result = vec![];
    expand(solution, name, false, &mut HashSet::new(), &mut result)?;
    Ok(result)
}

pub fn describe(solution: &CraiddSolution, name: &str) -> Result<Vec<String>, String> {
    Ok(plan(solution, name)?
        .iter()
        .map(|step| match step {
            OrderStep::Build { configuration } => {
                format!("Build {configuration} → wait for success")
            }
            OrderStep::Install {
                configuration,
                destination,
            } => format!("Install {configuration} → {destination}'s resolved output"),
        })
        .collect())
}

pub fn parse_arguments(line: &str) -> Result<Vec<String>, String> {
    let mut result = vec![];
    let mut current = String::new();
    let mut quote = None;
    let mut started = false;
    for character in line.chars() {
        if let Some(delimiter) = quote {
            if character == delimiter {
                quote = None;
            } else {
                current.push(character);
            }
        } else if matches!(character, '\'' | '"') {
            quote = Some(character);
            started = true;
        } else if character.is_whitespace() {
            if started {
                result.push(std::mem::take(&mut current));
                started = false;
            }
        } else {
            current.push(character);
            started = true;
        }
    }
    if quote.is_some() {
        return Err("Unclosed quote in build command".into());
    }
    if started {
        result.push(current);
    }
    Ok(result)
}

struct BuildSpec {
    cwd: PathBuf,
    program: String,
    args: Vec<String>,
    env: BTreeMap<String, String>,
    profile: String,
}

fn spec(
    solution: &CraiddSolution,
    config: &ConfigEntry,
    selected_profile: Option<&str>,
) -> Result<BuildSpec, String> {
    let root = Path::new(&solution.root)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let folder = if let Some(cwd) = &config.cwd {
        root.join(cwd)
    } else {
        let project = solution
            .projects
            .iter()
            .find(|project| project.path == config.target)
            .ok_or_else(|| format!("{} has no project", config.name))?;
        root.join(&project.folder)
    };
    let cwd = folder.canonicalize().map_err(|error| error.to_string())?;
    if !cwd.starts_with(&root) {
        return Err("Ordered builds must stay inside the solution".into());
    }
    let profile = selected_profile
        .and_then(|name| config.profiles.iter().find(|profile| profile.name == name))
        .or_else(|| {
            config
                .default_profile
                .as_ref()
                .and_then(|name| config.profiles.iter().find(|profile| &profile.name == name))
        })
        .or_else(|| config.profiles.first());
    let (program, mut args) = if let Some(command) = config
        .command
        .as_deref()
        .filter(|command| !command.trim().is_empty())
    {
        let mut parts = parse_arguments(command)?;
        if parts.is_empty() {
            return Err("Empty build command".into());
        }
        (parts.remove(0), parts)
    } else {
        let method = config.method.as_deref().ok_or("Build method is missing")?;
        (
            method.into(),
            if method == "cmake" {
                vec!["--build".into(), "build".into()]
            } else {
                vec!["build".into()]
            },
        )
    };
    if let Some(profile) = profile {
        args.extend(profile.args.clone());
    }
    if config.method.as_deref() == Some("cargo")
        && args.first().is_some_and(|arg| matches!(arg.as_str(), "build" | "check"))
        && !args.iter().any(|arg| arg.starts_with("--message-format"))
    {
        args.push("--message-format=json".into());
    }
    let expected = config.method.as_deref().ok_or("Build method is missing")?;
    if Path::new(&program)
        .file_name()
        .and_then(|name| name.to_str())
        != Some(expected)
    {
        return Err(format!(
            "{}: use the {} executable directly, not a shell wrapper",
            config.name, expected
        ));
    }
    Ok(BuildSpec {
        cwd,
        program,
        args,
        env: profile
            .map(|profile| profile.env.clone())
            .unwrap_or_default(),
        profile: profile
            .map(|profile| profile.name.clone())
            .unwrap_or_else(|| "Debug".into()),
    })
}

fn command(
    spec: &BuildSpec,
    args: &[String],
    job: &OrderJob,
    report: &(dyn Fn(String) + Sync),
) -> Result<Vec<String>, String> {
    job.check()?;
    let executable = super::toolchain::resolve_known_program(&spec.program)?
        .unwrap_or_else(|| spec.program.clone().into());
    report(format!("$ {} {}", executable.display(), args.join(" ")));
    let mut command = Command::new(executable);
    command
        .current_dir(&spec.cwd)
        .args(args)
        .envs(&spec.env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    unsafe {
        command.pre_exec(|| {
            if libc::setsid() == -1 {
                Err(std::io::Error::last_os_error())
            } else {
                Ok(())
            }
        });
    }
    let mut child = crate::process_supervisor::spawn(&mut command)
        .map_err(|error| format!("Could not start {}: {error}", spec.program))?;
    let pgid = child.id() as i32;
    job.pgid.store(pgid, Ordering::SeqCst);
    if job.check().is_err() {
        unsafe {
            libc::killpg(pgid, libc::SIGTERM);
        }
    }
    let stdout = child.stdout.take().ok_or("Build output is missing")?;
    let stderr = child.stderr.take().ok_or("Build errors are missing")?;
    let (status, lines) = std::thread::scope(|scope| {
        let out = scope.spawn(|| {
            let mut lines = vec![];
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                report(line.clone());
                lines.push(line);
            }
            lines
        });
        let err = scope.spawn(|| {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                report(line);
            }
        });
        let mut cancel_time = None;
        let status = loop {
            if job.cancelled.load(Ordering::SeqCst) {
                let started = cancel_time.get_or_insert_with(std::time::Instant::now);
                if started.elapsed() >= std::time::Duration::from_millis(500) {
                    unsafe {
                        libc::killpg(pgid, libc::SIGKILL);
                    }
                }
            }
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => std::thread::sleep(std::time::Duration::from_millis(30)),
                Err(error) => break Err(error),
            }
        };
        unsafe {
            libc::killpg(pgid, libc::SIGTERM);
        }
        let lines = out.join().unwrap_or_default();
        let _ = err.join();
        (status, lines)
    });
    job.pgid.store(0, Ordering::SeqCst);
    job.check()?;
    let status = status.map_err(|error| error.to_string())?;
    if !status.success() {
        return Err(format!(
            "{} failed ({status}); later steps were not started",
            spec.program
        ));
    }
    Ok(lines)
}

fn cmake_directory(spec: &BuildSpec) -> Result<String, String> {
    if spec.args.first().map(String::as_str) != Some("--build") {
        return Err("CMake build configuration must use --build <directory>".into());
    }
    spec.args
        .get(1)
        .cloned()
        .ok_or_else(|| "CMake build directory is missing".into())
}

fn dotnet_target(
    spec: &BuildSpec,
    job: &OrderJob,
    report: &(dyn Fn(String) + Sync),
) -> Result<PathBuf, String> {
    let project = spec
        .args
        .iter()
        .find(|arg| arg.ends_with(".csproj"))
        .map(|arg| spec.cwd.join(arg))
        .or_else(|| {
            let projects = std::fs::read_dir(&spec.cwd)
                .ok()?
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| {
                    path.extension().and_then(|extension| extension.to_str()) == Some("csproj")
                })
                .collect::<Vec<_>>();
            (projects.len() == 1).then(|| projects[0].clone())
        })
        .ok_or("Choose one .csproj for the .NET build")?;
    let mut args = vec![
        "msbuild".into(),
        project.to_string_lossy().into_owned(),
        "-nologo".into(),
        "-getProperty:TargetPath".into(),
    ];
    let mut index = 0;
    while index < spec.args.len() {
        let arg = &spec.args[index];
        if matches!(
            arg.as_str(),
            "-c" | "--configuration"
                | "-f"
                | "--framework"
                | "-r"
                | "--runtime"
                | "-o"
                | "--output"
        ) {
            let property = match arg.as_str() {
                "-c" | "--configuration" => "Configuration",
                "-f" | "--framework" => "TargetFramework",
                "-r" | "--runtime" => "RuntimeIdentifier",
                _ => "OutputPath",
            };
            index += 1;
            let value = spec
                .args
                .get(index)
                .ok_or("Missing .NET build argument value")?;
            args.push(format!("-property:{property}={value}"));
        } else if let Some((option, value)) = arg.split_once('=').filter(|(option, _)| {
            matches!(
                *option,
                "--configuration" | "--framework" | "--runtime" | "--output"
            )
        }) {
            let property = match option {
                "--configuration" => "Configuration",
                "--framework" => "TargetFramework",
                "--runtime" => "RuntimeIdentifier",
                _ => "OutputPath",
            };
            args.push(format!("-property:{property}={value}"));
        } else if arg.starts_with("-p:")
            || arg.starts_with("/p:")
            || arg.starts_with("-property:")
            || arg.starts_with("--property:")
        {
            args.push(if arg.starts_with("--property:") {
                arg.replacen("--property:", "-property:", 1)
            } else {
                arg.clone()
            });
        }
        index += 1;
    }
    // Profile names are UI labels, not MSBuild configurations. Without an
    // explicit argument let MSBuild use the same project default as build.
    let lines = command(spec, &args, job, report)?;
    let target = lines
        .iter()
        .rev()
        .find(|line| line.trim().ends_with(".dll"))
        .ok_or(".NET did not report TargetPath")?;
    spec.cwd
        .join(target.trim())
        .canonicalize()
        .map_err(|error| format!("Built .NET target is missing: {error}"))
}

/// Public pure execution seam also used by the real-tool acceptance test.
/// Returns the built .NET executable for the launch target, avoiding a
/// rebuild after installation. Build/install outputs stay tool-owned.
pub fn execute(
    solution: &CraiddSolution,
    request: &OrderRequest,
    job: &OrderJob,
    report: &(dyn Fn(String) + Sync),
) -> Result<Option<PathBuf>, String> {
    let steps = plan(solution, &request.configuration)?;
    let root = Path::new(&solution.root)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let launch_target = &configuration(solution, &request.configuration)?.target;
    let mut artifacts: HashMap<String, PathBuf> = HashMap::new();
    // Resolve all configurations before any side effects.
    let mut specs = HashMap::new();
    for step in &steps {
        let names = match step {
            OrderStep::Build { configuration } => vec![configuration],
            OrderStep::Install {
                configuration,
                destination,
            } => vec![configuration, destination],
        };
        for name in names {
            specs.insert(
                name.clone(),
                spec(
                    solution,
                    configuration(solution, name)?,
                    request.profile.as_deref(),
                )?,
            );
        }
    }
    for (index, step) in steps.iter().enumerate() {
        job.check()?;
        match step {
            OrderStep::Build {
                configuration: name,
            } => {
                report(format!(
                    "[Order {}/{}] Build {name}",
                    index + 1,
                    steps.len()
                ));
                let spec = &specs[name];
                if configuration(solution, name)?.method.as_deref() == Some("cmake") {
                    let directory = cmake_directory(spec)?;
                    let output = spec.cwd.join(&directory);
                    if !output.starts_with(&root)
                        || output
                            .components()
                            .any(|part| part == std::path::Component::ParentDir)
                    {
                        return Err(
                            "CMake output must stay inside the solution, without parent traversal"
                                .into(),
                        );
                    }
                    command(
                        spec,
                        &[
                            "-S".into(),
                            ".".into(),
                            "-B".into(),
                            directory,
                            format!("-DCMAKE_BUILD_TYPE={}", spec.profile),
                        ],
                        job,
                        report,
                    )?;
                }
                command(spec, &spec.args, job, report)?;
                if configuration(solution, name)?.method.as_deref() == Some("dotnet") {
                    artifacts.insert(name.clone(), dotnet_target(spec, job, report)?);
                }
                report(format!(
                    "[Order {}/{}] Build {name} succeeded",
                    index + 1,
                    steps.len()
                ));
            }
            OrderStep::Install {
                configuration: name,
                destination,
            } => {
                let output = artifacts
                    .get(destination)
                    .and_then(|artifact| artifact.parent())
                    .ok_or("Build the destination before installing")?;
                if !output.starts_with(&root) {
                    return Err("Artifact installation must stay inside the solution".into());
                }
                report(format!(
                    "[Order {}/{}] Install {name} → {}",
                    index + 1,
                    steps.len(),
                    output.display()
                ));
                let spec = &specs[name];
                command(
                    spec,
                    &[
                        "--install".into(),
                        cmake_directory(spec)?,
                        "--config".into(),
                        spec.profile.clone(),
                        "--prefix".into(),
                        output.to_string_lossy().into_owned(),
                    ],
                    job,
                    report,
                )?;
                report(format!(
                    "[Order {}/{}] Installation succeeded",
                    index + 1,
                    steps.len()
                ));
            }
        }
    }
    Ok(artifacts.into_iter().find_map(|(name, artifact)| {
        (configuration(solution, &name).ok()?.target == *launch_target).then_some(artifact)
    }))
}

pub async fn prepare(
    app: AppHandle,
    label: String,
    request: OrderRequest,
    report: impl Fn(String) + Send + Sync + 'static,
) -> Result<Option<PathBuf>, String> {
    let job = Arc::new(OrderJob::default());
    {
        let state = app.state::<OrderManager>();
        let mut jobs = state.0.lock().map_err(|error| error.to_string())?;
        if jobs.contains_key(&label) {
            return Err("This session is already preparing its build order".into());
        }
        jobs.insert(label.clone(), job.clone());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        // Avoid concurrent preparation jobs writing the same tool output.
        // This small proof deliberately serializes preparation; tools still
        // perform their own internal parallel/incremental builds.
        static EXECUTION: std::sync::OnceLock<Mutex<()>> = std::sync::OnceLock::new();
        let mutex = EXECUTION.get_or_init(|| Mutex::new(()));
        let _guard = loop {
            job.check()?;
            match mutex.try_lock() {
                Ok(guard) => break guard,
                Err(std::sync::TryLockError::WouldBlock) => {
                    std::thread::sleep(std::time::Duration::from_millis(50))
                }
                Err(error) => return Err(error.to_string()),
            }
        };
        let solution = load(&request)?;
        execute(&solution, &request, &job, &report)
    })
    .await
    .map_err(|error| error.to_string())
    .and_then(|result| result);
    if let Ok(mut jobs) = app.state::<OrderManager>().0.lock() {
        jobs.remove(&label);
    }
    result
}

pub fn preview(request: &OrderRequest) -> Result<Vec<String>, String> {
    describe(&load(request)?, &request.configuration)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn lab() -> (CraiddSolution, OrderRequest) {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("workspaces/build-order-lab");
        let request = OrderRequest {
            solution_path: root
                .join("build-order-lab.cln")
                .to_string_lossy()
                .into_owned(),
            configuration: "API · Debug".into(),
            profile: None,
        };
        (load(&request).unwrap(), request)
    }

    #[test]
    fn gui_lab_has_two_projects_and_resolves_build_and_install() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("workspaces/ldi-gui-lab");
        let solution = super::super::solution::load_solution_named(
            root.to_string_lossy().into_owned(),
            "ldi-gui-lab.cln".into(),
        )
        .unwrap()
        .unwrap()
        .solution;
        assert_eq!(solution.projects.len(), 2);
        assert!(solution
            .projects
            .iter()
            .any(|project| project.language.as_deref() == Some("csharp")
                && project.kind == "application"));
        assert!(
            solution
                .projects
                .iter()
                .any(|project| project.language.as_deref() == Some("cpp")
                    && project.kind == "library")
        );
        let native = solution
            .configs
            .iter()
            .find(|config| config.name == "Native · LDI")
            .unwrap()
            .slots
            .as_ref()
            .unwrap();
        assert_eq!(native.build.as_deref(), Some("Native · Build"));
        assert!(native.run.is_none() && native.debug.is_none());
        assert_eq!(
            describe(&solution, "GUI · Debug").unwrap(),
            vec![
                "Build GUI · Build → wait for success",
                "Build Native · Build → wait for success",
                "Install Native · Build → GUI · Build's resolved output",
            ]
        );
        assert_eq!(plan(&solution, "GUI · Run").unwrap().len(), 3);
    }

    #[test]
    fn interop_playground_builds_and_installs_both_libraries_before_gui_launch() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap()
            .join("workspaces/ldi-interop-playground");
        let solution = super::super::solution::load_solution_named(
            root.to_string_lossy().into_owned(),
            "ldi-interop-playground.cln".into(),
        )
        .unwrap()
        .unwrap()
        .solution;
        assert_eq!(solution.projects.len(), 2);
        assert_eq!(
            describe(&solution, "GUI · Debug").unwrap(),
            vec![
                "Build GUI · Build → wait for success",
                "Build Native · All Build → wait for success",
                "Install Native · All Build → GUI · Build's resolved output",
            ]
        );
        for (config, build) in [
            ("Native · Scalar LDI", "Native · Scalar Build"),
            ("Native · Packet LDI", "Native · Packet Build"),
        ] {
            let slot = solution.configs.iter().find(|item| item.name == config).unwrap().slots.as_ref().unwrap();
            assert_eq!(slot.build.as_deref(), Some(build));
            assert!(slot.run.is_none() && slot.debug.is_none());
        }
    }

    #[test]
    fn expands_the_demo_in_the_exact_requested_order() {
        let (solution, request) = lab();
        assert_eq!(
            describe(&solution, &request.configuration).unwrap(),
            vec![
                "Build API · Build → wait for success",
                "Build Native · Build → wait for success",
                "Install Native · Build → API · Build's resolved output"
            ]
        );
    }

    #[test]
    fn validates_cycles_and_installation_before_any_execution() {
        let (mut solution, request) = lab();
        let prepare = solution
            .configs
            .iter_mut()
            .find(|config| config.name == "Prepare application")
            .unwrap();
        prepare.order.as_mut().unwrap().steps.swap(0, 2);
        assert!(plan(&solution, &request.configuration)
            .unwrap_err()
            .contains("before installing"));
        let prepare = solution
            .configs
            .iter_mut()
            .find(|config| config.name == "Prepare application")
            .unwrap();
        prepare.order = Some(crate::types::BuildOrder {
            before: Some("Prepare application".into()),
            steps: vec![],
        });
        assert!(plan(&solution, &request.configuration)
            .unwrap_err()
            .contains("cycle"));
    }

    #[test]
    fn rejects_missing_builds_and_shell_wrappers() {
        let (mut solution, request) = lab();
        let build = solution
            .configs
            .iter_mut()
            .find(|config| config.name == "API · Build")
            .unwrap();
        build.command = Some("bash build-api.sh".into());
        assert!(spec(
            &solution,
            configuration(&solution, "API · Build").unwrap(),
            None
        )
        .err()
        .unwrap()
        .contains("not a shell wrapper"));
        solution
            .configs
            .retain(|config| config.name != "Native · Build");
        assert!(plan(&solution, &request.configuration)
            .unwrap_err()
            .contains("missing"));
        assert_eq!(
            parse_arguments("dotnet build 'directory with spaces/App.csproj'").unwrap(),
            vec!["dotnet", "build", "directory with spaces/App.csproj"]
        );
        assert!(parse_arguments("dotnet build 'unfinished").is_err());
    }

    #[test]
    fn cancellation_stops_before_the_first_step() {
        let (solution, request) = lab();
        let job = OrderJob::default();
        job.cancel();
        assert_eq!(
            execute(&solution, &request, &job, &|_| {}).unwrap_err(),
            "Build order cancelled"
        );
    }

    #[test]
    fn a_failed_build_does_not_start_later_steps() {
        let (mut solution, request) = lab();
        let build = solution
            .configs
            .iter_mut()
            .find(|config| config.name == "API · Build")
            .unwrap();
        // dotnet exits unsuccessfully without running a compiler or changing artifacts.
        build.command = Some("dotnet build --definitely-not-a-build-option".into());
        build.profiles.clear();
        let output = Mutex::new(Vec::new());
        let error = execute(&solution, &request, &OrderJob::default(), &|line| {
            output.lock().unwrap().push(line)
        })
        .unwrap_err();
        assert!(
            error.contains("later steps were not started") || error.contains("Could not start"),
            "{error}"
        );
        assert!(!output
            .lock()
            .unwrap()
            .iter()
            .any(|line| line.contains("[Order 2/")));
    }

    /// Real tools, no scripts: run explicitly when dotnet and cmake are installed.
    #[test]
    #[ignore = "requires .NET 10 SDK/runtime, CMake and a C++ compiler"]
    fn build_order_lab_real_tools() {
        use std::io::{Read, Write};
        let (solution, request) = lab();
        let job = OrderJob::default();
        let artifact = execute(&solution, &request, &job, &|text| println!("{text}"))
            .unwrap()
            .unwrap();
        assert!(artifact
            .parent()
            .unwrap()
            .join("liborder_math.so")
            .is_file());
        struct Server(std::process::Child);
        impl Drop for Server {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let _server = Server(
            Command::new("dotnet")
                .arg(&artifact)
                .args(["--urls", &format!("http://{address}")])
                .current_dir(artifact.parent().unwrap())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap(),
        );
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        let mut response = String::new();
        while std::time::Instant::now() < deadline {
            if let Ok(mut stream) = std::net::TcpStream::connect_timeout(
                &address,
                std::time::Duration::from_millis(100),
            ) {
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(1)))
                    .unwrap();
                stream
                    .write_all(
                        b"GET /health HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
                    )
                    .unwrap();
                response.clear();
                let _ = stream.read_to_string(&mut response);
                if response.contains("\"value\":42") {
                    break;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        assert!(
            response.starts_with("HTTP/1.1 200") && response.contains("\"value\":42"),
            "API failed native readiness: {response}"
        );
        println!(
            "ACCEPTANCE: C++ library installed into {} → C# health returns 42",
            artifact.parent().unwrap().display()
        );

        // A friendly profile name is not a Configuration or framework name.
        // Output discovery must follow the tool's arguments, including -o.
        let mut custom = solution.clone();
        let build = custom
            .configs
            .iter_mut()
            .find(|config| config.name == "API · Build")
            .unwrap();
        build.profiles[0].name = "Local".into();
        build.profiles[0].args = vec![
            "--output".into(),
            "build/custom-output".into(),
            "--nologo".into(),
        ];
        build.default_profile = Some("Local".into());
        let target = execute(&custom, &request, &OrderJob::default(), &|text| {
            println!("{text}")
        })
        .unwrap()
        .unwrap();
        assert_eq!(
            target.parent().unwrap(),
            Path::new(&custom.root).join("Api/build/custom-output")
        );
        assert!(target.parent().unwrap().join("liborder_math.so").is_file());
        println!(
            "ACCEPTANCE: custom output directory and friendly profile name resolved correctly"
        );
    }
}
