import ctypes
import os
import resource
import signal

_libc = ctypes.CDLL(None, use_errno=True)
_libc.syscall.restype = ctypes.c_long

_CREATE_RULESET, _ADD_RULE, _RESTRICT_SELF = 444, 445, 446
_CREATE_RULESET_VERSION = 1
_RULE_PATH_BENEATH = 1
_PR_SET_PDEATHSIG, _PR_SET_NO_NEW_PRIVS = 1, 38

_EXECUTE, _WRITE_FILE, _READ_FILE, _READ_DIR = 1 << 0, 1 << 1, 1 << 2, 1 << 3
_IOCTL_DEV = 1 << 15
_READ = _EXECUTE | _READ_FILE | _READ_DIR
SYSTEM_DIRS = ("/usr", "/opt", "/etc", "/var", "/proc", "/sys")


class _RulesetAttr(ctypes.Structure):
    _fields_ = [
        ("handled_access_fs", ctypes.c_uint64),
        ("handled_access_net", ctypes.c_uint64),
        ("scoped", ctypes.c_uint64),
    ]


class _PathBeneathAttr(ctypes.Structure):
    _pack_ = 1
    _fields_ = [("allowed_access", ctypes.c_uint64), ("parent_fd", ctypes.c_int32)]


def _check(result: int) -> int:
    if result < 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))
    return result


def _syscall(number: int, *args: object) -> int:
    return _check(_libc.syscall(ctypes.c_long(number), *args))


def _prctl(option: int, value: int) -> None:
    zero = ctypes.c_ulong(0)
    _check(_libc.prctl(ctypes.c_int(option), ctypes.c_ulong(value), zero, zero, zero))


def landlock_abi() -> int:
    try:
        return _syscall(_CREATE_RULESET, None, ctypes.c_size_t(0), ctypes.c_uint32(_CREATE_RULESET_VERSION))
    except OSError:
        return 0


def _fs_rights(abi: int) -> int:
    # ABI 1 handles 13 rights; ABI 2 adds REFER, ABI 3 TRUNCATE, ABI 5 IOCTL_DEV.
    count = {1: 13, 2: 14, 3: 15, 4: 15}.get(abi, 16)
    return (1 << count) - 1


def _allow(ruleset: int, path: str, access: int) -> None:
    try:
        fd = os.open(path, os.O_PATH | os.O_CLOEXEC)
    except FileNotFoundError:
        return
    try:
        rule = _PathBeneathAttr(access, fd)
        _syscall(
            _ADD_RULE,
            ctypes.c_int(ruleset),
            ctypes.c_int(_RULE_PATH_BENEATH),
            ctypes.byref(rule),
            ctypes.c_uint32(0),
        )
    finally:
        os.close(fd)


def _landlock(writable: str | None) -> int:
    abi = landlock_abi()
    if abi < 1:
        return 0
    rights = _fs_rights(abi)
    # Without a rule for them, TCP bind and connect (ABI 4) and signals or abstract sockets
    # towards processes outside the domain (ABI 6) are refused.
    attr = _RulesetAttr(rights, 0b11 if abi >= 4 else 0, 0b11 if abi >= 6 else 0)
    size = 8 if abi < 4 else 16 if abi < 6 else 24
    ruleset = _syscall(_CREATE_RULESET, ctypes.byref(attr), ctypes.c_size_t(size), ctypes.c_uint32(0))
    try:
        for path in SYSTEM_DIRS:
            _allow(ruleset, path, _READ & rights)
        _allow(ruleset, "/dev", (_READ | _WRITE_FILE | _IOCTL_DEV) & rights)
        if writable is not None:
            _allow(ruleset, writable, rights)
        _syscall(_RESTRICT_SELF, ctypes.c_int(ruleset), ctypes.c_uint32(0))
    finally:
        os.close(ruleset)
    return abi


def confine(writable: str | None, cpu_seconds: int | None = None, max_file_bytes: int | None = None) -> int:
    # The memory limit of the container must kill the job before the runner.
    with open("/proc/self/oom_score_adj", "w") as score:
        score.write("1000")
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    if cpu_seconds is not None:
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_seconds, cpu_seconds))
    if max_file_bytes is not None:
        resource.setrlimit(resource.RLIMIT_FSIZE, (max_file_bytes, max_file_bytes))
    _prctl(_PR_SET_PDEATHSIG, signal.SIGKILL)
    _prctl(_PR_SET_NO_NEW_PRIVS, 1)
    return _landlock(writable)
