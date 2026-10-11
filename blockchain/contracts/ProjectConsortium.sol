// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ProjectConsortium - inter-college final-year project verification
/// @notice Several colleges share one ledger of final-year projects. A college
///         registers its students' project (report hash, similarity fingerprint,
///         hashed team, guide, year). The record becomes "Verified" only when
///         K of the consortium's colleges have endorsed it: the registering
///         college counts as the first endorsement, the others review it.
///         This mirrors a Hyperledger Fabric endorsement policy such as
///         "OutOf(2, College1, College2, ...)", enforced here by a smart contract.
/// @dev Privacy: student names and roll numbers never reach the chain. Only
///      teamHash = SHA-256(salt ‖ sorted roll numbers) and display initials are
///      stored; the salt stays with the college. The report itself stays
///      off-chain too: only its SHA-256 and a 128-byte MinHash fingerprint
///      (32 x uint32) are stored, so any college can run a similarity scan.
contract ProjectConsortium {
    /// @dev Stored states. `Expired` is never stored: statusOf() reports it
    ///      for a Pending project whose review window has closed.
    enum Status { Pending, Verified, Disputed, Rejected, Revoked, Expired }

    struct College {
        string name;
        string code;      // short code, e.g. "RIT"
        bool active;
        bool exists;
        uint64 joinedAt;
    }

    struct Project {
        address college;        // registering college (owner of the record)
        uint16 year;            // academic year of submission
        Status status;
        uint8 endorsements;     // includes the registering college
        uint8 required;         // endorsement threshold in force at registration
        uint64 registeredAt;
        uint64 reviewDeadline;  // endorsements are accepted until this time
        uint64 verifiedAt;
        bytes32 reportHash;     // SHA-256 of the report text (exact-copy check)
        bytes32 teamHash;       // SHA-256(salt ‖ sorted roll numbers)
        uint256 similarToId;    // near-duplicate declared by the registrant (0 = none)
        string title;
        string domain;
        string teamDisplay;     // initials only, e.g. "A.K., R.M."
        string guide;
        string note;            // last dispute ruling or revocation reason
    }

    /// @notice Public metadata supplied at registration (kept small: no names).
    struct ProjectInfo {
        string title;
        string domain;          // e.g. "IoT & Agriculture"
        uint16 year;
        string teamDisplay;     // initials only
        string guide;           // project guide (faculty supervisor)
    }

    struct Flag {
        address college;        // college that raised the flag
        uint256 similarToId;    // project it appears to copy (0 = outside source)
        string reason;
        uint64 time;
    }

    /// @notice Colleges have 30 days to review (endorse) a newly registered project.
    uint64 public constant REVIEW_PERIOD = 30 days;
    /// @notice MinHash fingerprint size: 32 hash functions x 4 bytes.
    uint256 public constant FINGERPRINT_BYTES = 128;

    /// @notice The University Consortium Board (deployer): admits colleges,
    ///         sets the endorsement threshold and resolves disputes.
    address public immutable board;
    /// @notice K in "K of N colleges must endorse" for newly registered projects.
    uint8 public threshold;
    uint8 public activeColleges;
    uint256 public projectCount;

    mapping(address => College) public colleges;
    address[] private collegeList;
    mapping(bytes32 => bool) private codeUsed;

    mapping(uint256 => Project) private projects;          // ids start at 1
    mapping(uint256 => bytes) private fingerprints;
    mapping(uint256 => address[]) private endorsers;
    mapping(uint256 => mapping(address => bool)) public hasEndorsed;
    mapping(uint256 => Flag[]) private flags;
    mapping(bytes32 => uint256) private idByReportHash;
    mapping(address => uint256[]) private collegeProjects;

    event CollegeAdded(address indexed college, string name, string code);
    event CollegeStatusChanged(address indexed college, bool active);
    event ThresholdChanged(uint8 oldThreshold, uint8 newThreshold);
    event ProjectRegistered(uint256 indexed id, address indexed college, string title, uint16 year, bytes32 reportHash, uint256 similarToId, uint8 required);
    event ProjectEndorsed(uint256 indexed id, address indexed college, uint8 endorsements, uint8 required);
    event ProjectVerified(uint256 indexed id, uint8 endorsements);
    event ProjectFlagged(uint256 indexed id, address indexed college, uint256 similarToId, string reason);
    event DisputeResolved(uint256 indexed id, bool upheld, Status newStatus, string note);
    event ProjectRevoked(uint256 indexed id, string reason);

    error NotBoard();
    error NotActiveCollege();
    error InvalidCollege();
    error AlreadyCollege(address account);
    error CodeTaken(string code);
    error UnknownCollege(address account);
    error InvalidThreshold(uint256 k, uint256 activeColleges);
    error InvalidProject();
    error InvalidFingerprint(uint256 length);
    error DuplicateReport(uint256 existingId);
    error UnknownProject(uint256 id);
    error InvalidReference(uint256 similarToId);
    error OwnProject(uint256 id);
    error AlreadyEndorsed(uint256 id);
    error NotEndorsable(uint256 id, Status status);
    error ReviewClosed(uint256 id, uint256 deadline);
    error NotFlaggable(uint256 id, Status status);
    error EmptyReason();
    error NotDisputed(uint256 id);
    error NotProjectOwner(uint256 id);
    error CannotRevoke(uint256 id, Status status);

    modifier onlyBoard() {
        if (msg.sender != board) revert NotBoard();
        _;
    }

    modifier onlyActiveCollege() {
        if (!colleges[msg.sender].active) revert NotActiveCollege();
        _;
    }

    modifier projectExists(uint256 id) {
        if (id == 0 || id > projectCount) revert UnknownProject(id);
        _;
    }

    constructor() {
        board = msg.sender;
        threshold = 2; // default policy: own college + at least one other
    }

    // ------------------------------------------------------------------
    // Consortium governance (Module IV: permissioned membership)
    // ------------------------------------------------------------------

    /// @notice Admit a college to the consortium.
    function addCollege(address account, string calldata name, string calldata code) external onlyBoard {
        if (account == address(0) || account == board || bytes(name).length == 0 || bytes(code).length == 0) revert InvalidCollege();
        if (colleges[account].exists) revert AlreadyCollege(account);
        bytes32 codeKey = keccak256(bytes(code));
        if (codeUsed[codeKey]) revert CodeTaken(code);
        codeUsed[codeKey] = true;
        colleges[account] = College(name, code, true, true, uint64(block.timestamp));
        collegeList.push(account);
        activeColleges += 1;
        emit CollegeAdded(account, name, code);
    }

    /// @notice Suspend or re-activate a college. A suspended college keeps its
    ///         records but cannot register, endorse or flag. Suspending is
    ///         refused if fewer active colleges than the threshold would remain.
    function setCollegeActive(address account, bool active) external onlyBoard {
        College storage c = colleges[account];
        if (!c.exists) revert UnknownCollege(account);
        if (c.active == active) return;
        if (!active && activeColleges - 1 < threshold) revert InvalidThreshold(threshold, activeColleges - 1);
        c.active = active;
        if (active) activeColleges += 1;
        else activeColleges -= 1;
        emit CollegeStatusChanged(account, active);
    }

    /// @notice Set the endorsement threshold K (2 <= K <= active colleges).
    ///         It applies to projects registered from now on; each project keeps
    ///         the policy that was in force when it was submitted.
    function setThreshold(uint8 k) external onlyBoard {
        if (k < 2 || k > activeColleges) revert InvalidThreshold(k, activeColleges);
        emit ThresholdChanged(threshold, k);
        threshold = k;
    }

    // ------------------------------------------------------------------
    // Project lifecycle
    // ------------------------------------------------------------------

    /// @notice Register a project. The caller (an active college) is the first endorser.
    /// @param reportHash   SHA-256 of the report text; an identical report cannot be registered twice
    /// @param fingerprint  MinHash signature of the report (32 x uint32, big-endian, 128 bytes)
    /// @param info         public metadata: title, domain, year, team initials, guide
    /// @param teamHash     SHA-256(salt ‖ sorted roll numbers); the salt stays with the college
    /// @param similarToId  a near-duplicate the college acknowledges (0 if none)
    function registerProject(
        ProjectInfo calldata info,
        bytes32 reportHash,
        bytes calldata fingerprint,
        bytes32 teamHash,
        uint256 similarToId
    ) external onlyActiveCollege returns (uint256 id) {
        if (bytes(info.title).length == 0 || reportHash == bytes32(0) || teamHash == bytes32(0) || info.year < 2000 || info.year > 2100) {
            revert InvalidProject();
        }
        if (fingerprint.length != FINGERPRINT_BYTES) revert InvalidFingerprint(fingerprint.length);
        if (similarToId > projectCount) revert InvalidReference(similarToId);
        _checkNotDuplicate(reportHash);

        id = ++projectCount;
        Project storage p = projects[id];
        p.college = msg.sender;
        p.year = info.year;
        p.endorsements = 1;
        p.required = threshold;
        p.registeredAt = uint64(block.timestamp);
        p.reviewDeadline = uint64(block.timestamp) + REVIEW_PERIOD;
        p.reportHash = reportHash;
        p.teamHash = teamHash;
        p.similarToId = similarToId;
        p.title = info.title;
        p.domain = info.domain;
        p.teamDisplay = info.teamDisplay;
        p.guide = info.guide;

        fingerprints[id] = fingerprint;
        hasEndorsed[id][msg.sender] = true;
        endorsers[id].push(msg.sender);
        idByReportHash[reportHash] = id;
        collegeProjects[msg.sender].push(id);
        emit ProjectRegistered(id, msg.sender, info.title, info.year, reportHash, similarToId, p.required);
    }

    /// @dev An exact copy is refused. The only exception: a college may register
    ///      a corrected record for a report whose earlier record it revoked itself.
    function _checkNotDuplicate(bytes32 reportHash) private view {
        uint256 existing = idByReportHash[reportHash];
        if (existing == 0) return;
        Project storage e = projects[existing];
        if (e.status == Status.Revoked && e.college == msg.sender) return;
        revert DuplicateReport(existing);
    }

    /// @notice Another active college endorses (vouches for) a project, once.
    ///         The project becomes Verified when endorsements reach its threshold.
    function endorseProject(uint256 id) external onlyActiveCollege projectExists(id) {
        Project storage p = projects[id];
        if (p.college == msg.sender) revert OwnProject(id);
        if (p.status != Status.Pending && p.status != Status.Verified) revert NotEndorsable(id, p.status);
        if (block.timestamp > p.reviewDeadline) revert ReviewClosed(id, p.reviewDeadline);
        if (hasEndorsed[id][msg.sender]) revert AlreadyEndorsed(id);

        hasEndorsed[id][msg.sender] = true;
        endorsers[id].push(msg.sender);
        p.endorsements += 1;
        emit ProjectEndorsed(id, msg.sender, p.endorsements, p.required);

        if (p.status == Status.Pending && p.endorsements >= p.required) {
            p.status = Status.Verified;
            p.verifiedAt = uint64(block.timestamp);
            emit ProjectVerified(id, p.endorsements);
        }
    }

    /// @notice Any other active college can flag a project as a suspected
    ///         duplicate. The project is Disputed until the board rules.
    function flagProject(uint256 id, uint256 similarToId, string calldata reason) external onlyActiveCollege projectExists(id) {
        Project storage p = projects[id];
        if (p.college == msg.sender) revert OwnProject(id);
        if (p.status != Status.Pending && p.status != Status.Verified) revert NotFlaggable(id, p.status);
        if (similarToId == id || similarToId > projectCount) revert InvalidReference(similarToId);
        if (bytes(reason).length == 0) revert EmptyReason();

        flags[id].push(Flag(msg.sender, similarToId, reason, uint64(block.timestamp)));
        p.status = Status.Disputed;
        emit ProjectFlagged(id, msg.sender, similarToId, reason);
    }

    /// @notice The board rules on a dispute. Upheld: the project is Rejected for
    ///         good. Dismissed: it returns to Verified or Pending by its endorsements.
    function resolveDispute(uint256 id, bool upheld, string calldata note) external onlyBoard projectExists(id) {
        Project storage p = projects[id];
        if (p.status != Status.Disputed) revert NotDisputed(id);
        if (bytes(note).length == 0) revert EmptyReason();

        if (upheld) {
            p.status = Status.Rejected;
        } else if (p.endorsements >= p.required) {
            p.status = Status.Verified;
            if (p.verifiedAt == 0) p.verifiedAt = uint64(block.timestamp);
        } else {
            p.status = Status.Pending;
        }
        p.note = note;
        emit DisputeResolved(id, upheld, p.status, note);
    }

    /// @notice The owning college withdraws its record (e.g. wrong details).
    ///         Not allowed while a dispute is open or after a final ruling.
    function revokeProject(uint256 id, string calldata reason) external projectExists(id) {
        Project storage p = projects[id];
        if (p.college != msg.sender) revert NotProjectOwner(id);
        if (p.status == Status.Disputed || p.status == Status.Rejected || p.status == Status.Revoked) revert CannotRevoke(id, p.status);
        if (bytes(reason).length == 0) revert EmptyReason();
        p.status = Status.Revoked;
        p.note = reason;
        emit ProjectRevoked(id, reason);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice Effective status: a Pending project past its review deadline is Expired.
    function statusOf(uint256 id) public view projectExists(id) returns (Status) {
        Project storage p = projects[id];
        if (p.status == Status.Pending && block.timestamp > p.reviewDeadline) return Status.Expired;
        return p.status;
    }

    function getProject(uint256 id) external view projectExists(id) returns (Project memory) {
        return projects[id];
    }

    /// @return the colleges that endorsed the project, the registering college first
    function getEndorsements(uint256 id) external view projectExists(id) returns (address[] memory) {
        return endorsers[id];
    }

    function getFlags(uint256 id) external view projectExists(id) returns (Flag[] memory) {
        return flags[id];
    }

    function getFingerprint(uint256 id) external view projectExists(id) returns (bytes memory) {
        return fingerprints[id];
    }

    /// @notice Every fingerprint on the ledger (index 0 = project #1), for the similarity scan.
    function getAllFingerprints() external view returns (bytes[] memory all) {
        all = new bytes[](projectCount);
        for (uint256 i = 0; i < projectCount; i++) all[i] = fingerprints[i + 1];
    }

    /// @return id the project registered with this exact report hash (0 if none)
    function findByReportHash(bytes32 reportHash) external view returns (uint256) {
        return idByReportHash[reportHash];
    }

    function getCollegeProjects(address college) external view returns (uint256[] memory) {
        return collegeProjects[college];
    }

    function getColleges() external view returns (address[] memory accounts, College[] memory info) {
        accounts = collegeList;
        info = new College[](collegeList.length);
        for (uint256 i = 0; i < collegeList.length; i++) info[i] = colleges[collegeList[i]];
    }
}
