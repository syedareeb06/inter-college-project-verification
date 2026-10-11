const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const Status = { Pending: 0, Verified: 1, Disputed: 2, Rejected: 3, Revoked: 4, Expired: 5 };
const DAY = 24 * 60 * 60;
const sha = (text) => ethers.sha256(ethers.toUtf8Bytes(text));
// A MinHash fingerprint is 32 x uint32 = 128 bytes; the contract only checks its length.
const fp = (byte = "ab") => "0x" + byte.repeat(128);

describe("ProjectConsortium", function () {
  async function deployFixture() {
    const [board, rit, nce, lvp, hsc, outsider, extra] = await ethers.getSigners();
    const c = await ethers.deployContract("ProjectConsortium", [], board);
    await c.addCollege(rit.address, "Riverside Institute of Technology", "RIT");
    await c.addCollege(nce.address, "Northgate College of Engineering", "NCE");
    await c.addCollege(lvp.address, "Lakeview Polytechnic", "LVP");
    await c.addCollege(hsc.address, "Hillcrest School of Computing", "HSC");

    /** registerProject with sensible defaults; `o` overrides any field. */
    const register = (college, o = {}) =>
      c.connect(college).registerProject(
        [o.title ?? "Smart Irrigation Controller", o.domain ?? "IoT & Agriculture", o.year ?? 2025, o.team ?? "A.K., R.M.", o.guide ?? "Prof. A. Menon"],
        o.reportHash ?? sha(o.report ?? "irrigation report"),
        o.fingerprint ?? fp(),
        o.teamHash ?? sha("salt|21RIT001,21RIT002"),
        o.similarToId ?? 0
      );

    return { c, board, rit, nce, lvp, hsc, outsider, extra, register };
  }

  async function registeredFixture() {
    const f = await deployFixture();
    await f.register(f.rit); // project #1 by Riverside
    return f;
  }

  describe("Consortium governance", function () {
    it("the board admits colleges and lists them", async function () {
      const { c, board, extra } = await loadFixture(deployFixture);
      expect(await c.board()).to.equal(board.address);
      expect(await c.activeColleges()).to.equal(4);
      expect(await c.threshold()).to.equal(2);
      await expect(c.addCollege(extra.address, "Westbrook College", "WBC"))
        .to.emit(c, "CollegeAdded").withArgs(extra.address, "Westbrook College", "WBC");
      const [accounts, info] = await c.getColleges();
      expect(accounts.length).to.equal(5);
      expect(info[0].name).to.equal("Riverside Institute of Technology");
      expect(info[4].code).to.equal("WBC");
      expect(info[4].active).to.equal(true);
    });

    it("only the board can govern the consortium", async function () {
      const { c, rit, outsider } = await loadFixture(registeredFixture);
      await expect(c.connect(rit).addCollege(outsider.address, "Fake College", "FAKE")).to.be.revertedWithCustomError(c, "NotBoard");
      await expect(c.connect(rit).setThreshold(3)).to.be.revertedWithCustomError(c, "NotBoard");
      await expect(c.connect(outsider).setCollegeActive(rit.address, false)).to.be.revertedWithCustomError(c, "NotBoard");
      await expect(c.connect(rit).resolveDispute(1, true, "no")).to.be.revertedWithCustomError(c, "NotBoard");
    });

    it("rejects invalid, duplicate and same-code colleges", async function () {
      const { c, board, rit, extra } = await loadFixture(deployFixture);
      await expect(c.addCollege(ethers.ZeroAddress, "X", "X")).to.be.revertedWithCustomError(c, "InvalidCollege");
      await expect(c.addCollege(board.address, "Board", "BRD")).to.be.revertedWithCustomError(c, "InvalidCollege");
      await expect(c.addCollege(extra.address, "", "X")).to.be.revertedWithCustomError(c, "InvalidCollege");
      await expect(c.addCollege(rit.address, "Again", "AGN")).to.be.revertedWithCustomError(c, "AlreadyCollege").withArgs(rit.address);
      await expect(c.addCollege(extra.address, "Copycat", "RIT")).to.be.revertedWithCustomError(c, "CodeTaken").withArgs("RIT");
    });

    it("keeps the threshold between 2 and the number of active colleges", async function () {
      const { c } = await loadFixture(deployFixture);
      await expect(c.setThreshold(1)).to.be.revertedWithCustomError(c, "InvalidThreshold").withArgs(1, 4);
      await expect(c.setThreshold(5)).to.be.revertedWithCustomError(c, "InvalidThreshold").withArgs(5, 4);
      await expect(c.setThreshold(3)).to.emit(c, "ThresholdChanged").withArgs(2, 3);
      expect(await c.threshold()).to.equal(3);
    });

    it("suspends colleges, but never below the threshold", async function () {
      const { c, rit, nce, outsider, register } = await loadFixture(deployFixture);
      await expect(c.setCollegeActive(outsider.address, false)).to.be.revertedWithCustomError(c, "UnknownCollege").withArgs(outsider.address);
      await expect(c.setCollegeActive(nce.address, false)).to.emit(c, "CollegeStatusChanged").withArgs(nce.address, false);
      expect(await c.activeColleges()).to.equal(3);
      await expect(register(nce)).to.be.revertedWithCustomError(c, "NotActiveCollege");
      await c.setThreshold(3);
      await expect(c.setCollegeActive(rit.address, false)).to.be.revertedWithCustomError(c, "InvalidThreshold").withArgs(3, 2);
      await c.setCollegeActive(nce.address, true);
      expect(await c.activeColleges()).to.equal(4);
    });
  });

  describe("Project registration", function () {
    it("stores hashes and the fingerprint; the registering college is the first endorser", async function () {
      const { c, rit, register } = await loadFixture(deployFixture);
      const reportHash = sha("irrigation report");
      await expect(register(rit))
        .to.emit(c, "ProjectRegistered")
        .withArgs(1, rit.address, "Smart Irrigation Controller", 2025, reportHash, 0, 2);
      const p = await c.getProject(1);
      expect(p.college).to.equal(rit.address);
      expect(p.status).to.equal(Status.Pending);
      expect(p.endorsements).to.equal(1);
      expect(p.required).to.equal(2);
      expect(p.teamDisplay).to.equal("A.K., R.M.");
      expect(p.reviewDeadline - p.registeredAt).to.equal(30n * BigInt(DAY));
      expect(await c.getEndorsements(1)).to.deep.equal([rit.address]);
      expect(await c.getFingerprint(1)).to.equal(fp());
      expect(await c.findByReportHash(reportHash)).to.equal(1);
      expect(await c.findByReportHash(sha("unknown"))).to.equal(0);
      expect(await c.getCollegeProjects(rit.address)).to.deep.equal([1n]);
      expect(await c.statusOf(1)).to.equal(Status.Pending);
    });

    it("only active colleges can register (not the board, not outsiders)", async function () {
      const { c, board, outsider, register } = await loadFixture(deployFixture);
      await expect(register(outsider)).to.be.revertedWithCustomError(c, "NotActiveCollege");
      await expect(register(board)).to.be.revertedWithCustomError(c, "NotActiveCollege");
    });

    it("validates the record, the fingerprint size and the similarity reference", async function () {
      const { c, rit, register } = await loadFixture(registeredFixture);
      await expect(register(rit, { title: "", report: "a" })).to.be.revertedWithCustomError(c, "InvalidProject");
      await expect(register(rit, { reportHash: ethers.ZeroHash })).to.be.revertedWithCustomError(c, "InvalidProject");
      await expect(register(rit, { teamHash: ethers.ZeroHash, report: "b" })).to.be.revertedWithCustomError(c, "InvalidProject");
      await expect(register(rit, { year: 1999, report: "c" })).to.be.revertedWithCustomError(c, "InvalidProject");
      await expect(register(rit, { fingerprint: "0x" + "ab".repeat(64), report: "d" }))
        .to.be.revertedWithCustomError(c, "InvalidFingerprint").withArgs(64);
      await expect(register(rit, { similarToId: 9, report: "e" })).to.be.revertedWithCustomError(c, "InvalidReference").withArgs(9);
      await expect(register(rit, { similarToId: 1, report: "f" })).to.emit(c, "ProjectRegistered");
      expect((await c.getProject(2)).similarToId).to.equal(1);
    });

    it("refuses an exact copy of a report already on the ledger", async function () {
      const { c, rit, lvp, register } = await loadFixture(registeredFixture);
      await expect(register(lvp, { title: "Automated Farm Irrigation" })).to.be.revertedWithCustomError(c, "DuplicateReport").withArgs(1);
      await expect(register(rit)).to.be.revertedWithCustomError(c, "DuplicateReport").withArgs(1);
    });

    it("lets only the same college re-register a report whose record it revoked", async function () {
      const { c, rit, nce, register } = await loadFixture(registeredFixture);
      await c.connect(rit).revokeProject(1, "Wrong guide name");
      await expect(register(nce)).to.be.revertedWithCustomError(c, "DuplicateReport").withArgs(1);
      await expect(register(rit, { guide: "Prof. B. Iyer" })).to.emit(c, "ProjectRegistered");
      expect(await c.findByReportHash(sha("irrigation report"))).to.equal(2);
    });
  });

  describe("Endorsement policy (K of N colleges)", function () {
    it("verifies a project once K colleges have endorsed it", async function () {
      const { c, nce, lvp } = await loadFixture(registeredFixture);
      await expect(c.connect(nce).endorseProject(1))
        .to.emit(c, "ProjectEndorsed").withArgs(1, nce.address, 2, 2)
        .and.to.emit(c, "ProjectVerified").withArgs(1, 2);
      expect(await c.statusOf(1)).to.equal(Status.Verified);
      expect((await c.getProject(1)).verifiedAt).to.be.greaterThan(0);
      // further endorsements are still recorded
      await expect(c.connect(lvp).endorseProject(1)).to.emit(c, "ProjectEndorsed").withArgs(1, lvp.address, 3, 2);
      expect(await c.getEndorsements(1)).to.have.length(3);
      expect(await c.hasEndorsed(1, lvp.address)).to.equal(true);
    });

    it("blocks self-endorsement, double endorsement, outsiders and unknown projects", async function () {
      const { c, rit, nce, outsider } = await loadFixture(registeredFixture);
      await expect(c.connect(rit).endorseProject(1)).to.be.revertedWithCustomError(c, "OwnProject").withArgs(1);
      await c.connect(nce).endorseProject(1);
      await expect(c.connect(nce).endorseProject(1)).to.be.revertedWithCustomError(c, "AlreadyEndorsed").withArgs(1);
      await expect(c.connect(outsider).endorseProject(1)).to.be.revertedWithCustomError(c, "NotActiveCollege");
      await expect(c.connect(nce).endorseProject(0)).to.be.revertedWithCustomError(c, "UnknownProject").withArgs(0);
      await expect(c.connect(nce).endorseProject(7)).to.be.revertedWithCustomError(c, "UnknownProject").withArgs(7);
      await expect(c.getProject(7)).to.be.revertedWithCustomError(c, "UnknownProject");
    });

    it("each project keeps the threshold in force when it was registered", async function () {
      const { c, nce, lvp, hsc, register } = await loadFixture(registeredFixture);
      await c.setThreshold(3);
      await register(nce, { report: "pothole report", title: "Pothole Detection" }); // #2 needs 3
      expect((await c.getProject(2)).required).to.equal(3);
      await c.connect(lvp).endorseProject(1); // #1 still needs only 2
      expect(await c.statusOf(1)).to.equal(Status.Verified);
      await c.connect(lvp).endorseProject(2);
      expect(await c.statusOf(2)).to.equal(Status.Pending);
      await c.connect(hsc).endorseProject(2);
      expect(await c.statusOf(2)).to.equal(Status.Verified);
    });

    it("accepts endorsements until the end of the 30-day review window", async function () {
      const { c, nce } = await loadFixture(registeredFixture);
      const deadline = (await c.getProject(1)).reviewDeadline;
      await time.setNextBlockTimestamp(deadline); // the last second of the window
      await expect(c.connect(nce).endorseProject(1)).to.emit(c, "ProjectVerified");
    });

    it("closes the review window after 30 days: the project expires", async function () {
      const { c, nce } = await loadFixture(registeredFixture);
      const deadline = (await c.getProject(1)).reviewDeadline;
      await time.increase(29 * DAY);
      expect(await c.statusOf(1)).to.equal(Status.Pending);
      await time.increaseTo(deadline + 1n);
      expect(await c.statusOf(1)).to.equal(Status.Expired);
      await expect(c.connect(nce).endorseProject(1)).to.be.revertedWithCustomError(c, "ReviewClosed").withArgs(1, deadline);
    });
  });

  describe("Duplicate flags and disputes", function () {
    async function disputeFixture() {
      const f = await registeredFixture();
      await f.c.connect(f.nce).endorseProject(1); // #1 Verified
      await f.register(f.lvp, { title: "Automated Farm Irrigation", report: "reworded irrigation report", similarToId: 1 }); // #2
      return f;
    }

    it("another college flags a suspected duplicate: the project is disputed", async function () {
      const { c, rit, hsc } = await loadFixture(disputeFixture);
      await expect(c.connect(rit).flagProject(2, 1, "72% MinHash similarity with project #1"))
        .to.emit(c, "ProjectFlagged").withArgs(2, rit.address, 1, "72% MinHash similarity with project #1");
      expect(await c.statusOf(2)).to.equal(Status.Disputed);
      const flags = await c.getFlags(2);
      expect(flags).to.have.length(1);
      expect(flags[0].college).to.equal(rit.address);
      expect(flags[0].similarToId).to.equal(1);
      await expect(c.connect(hsc).endorseProject(2)).to.be.revertedWithCustomError(c, "NotEndorsable").withArgs(2, Status.Disputed);
      await expect(c.connect(hsc).flagProject(2, 1, "me too")).to.be.revertedWithCustomError(c, "NotFlaggable").withArgs(2, Status.Disputed);
    });

    it("validates who flags, the reference and the reason", async function () {
      const { c, lvp, nce, outsider } = await loadFixture(disputeFixture);
      await expect(c.connect(lvp).flagProject(2, 1, "x")).to.be.revertedWithCustomError(c, "OwnProject").withArgs(2);
      await expect(c.connect(outsider).flagProject(2, 1, "x")).to.be.revertedWithCustomError(c, "NotActiveCollege");
      await expect(c.connect(nce).flagProject(2, 2, "x")).to.be.revertedWithCustomError(c, "InvalidReference").withArgs(2);
      await expect(c.connect(nce).flagProject(2, 5, "x")).to.be.revertedWithCustomError(c, "InvalidReference").withArgs(5);
      await expect(c.connect(nce).flagProject(2, 1, "")).to.be.revertedWithCustomError(c, "EmptyReason");
      await expect(c.connect(nce).flagProject(2, 0, "Copied from a public blog")).to.emit(c, "ProjectFlagged");
    });

    it("the board upholds a dispute: the project is rejected for good", async function () {
      const { c, rit, nce, lvp, register } = await loadFixture(disputeFixture);
      await c.connect(rit).flagProject(2, 1, "copy of #1");
      await expect(c.resolveDispute(2, true, "Plagiarism confirmed"))
        .to.emit(c, "DisputeResolved").withArgs(2, true, Status.Rejected, "Plagiarism confirmed");
      expect(await c.statusOf(2)).to.equal(Status.Rejected);
      expect((await c.getProject(2)).note).to.equal("Plagiarism confirmed");
      await expect(c.resolveDispute(2, false, "again")).to.be.revertedWithCustomError(c, "NotDisputed").withArgs(2);
      await expect(c.connect(nce).flagProject(2, 1, "x")).to.be.revertedWithCustomError(c, "NotFlaggable").withArgs(2, Status.Rejected);
      await expect(c.connect(nce).endorseProject(2)).to.be.revertedWithCustomError(c, "NotEndorsable").withArgs(2, Status.Rejected);
      await expect(c.connect(lvp).revokeProject(2, "withdraw")).to.be.revertedWithCustomError(c, "CannotRevoke").withArgs(2, Status.Rejected);
      // the rejected report stays blocked, even for the college that submitted it
      await expect(register(lvp, { report: "reworded irrigation report" })).to.be.revertedWithCustomError(c, "DuplicateReport").withArgs(2);
    });

    it("a dismissed dispute restores the status the endorsements justify", async function () {
      const { c, rit, nce, hsc } = await loadFixture(disputeFixture);
      await c.connect(nce).flagProject(1, 0, "looks familiar"); // #1 was Verified
      await expect(c.resolveDispute(1, false, "Original work")).to.emit(c, "DisputeResolved").withArgs(1, false, Status.Verified, "Original work");
      expect(await c.statusOf(1)).to.equal(Status.Verified);
      await c.connect(rit).flagProject(2, 1, "copy of #1"); // #2 was Pending
      await expect(c.resolveDispute(2, false, "")).to.be.revertedWithCustomError(c, "EmptyReason");
      await c.resolveDispute(2, false, "Declared extension of #1, accepted");
      expect(await c.statusOf(2)).to.equal(Status.Pending);
      await c.connect(hsc).endorseProject(2);
      expect(await c.statusOf(2)).to.equal(Status.Verified);
    });

    it("only open disputes can be resolved", async function () {
      const { c } = await loadFixture(disputeFixture);
      await expect(c.resolveDispute(2, true, "note")).to.be.revertedWithCustomError(c, "NotDisputed").withArgs(2);
      await expect(c.resolveDispute(9, true, "note")).to.be.revertedWithCustomError(c, "UnknownProject").withArgs(9);
    });
  });

  describe("Revocation and views", function () {
    it("only the owning college can revoke, with a reason, and not during a dispute", async function () {
      const { c, rit, nce, register } = await loadFixture(registeredFixture);
      await expect(c.connect(nce).revokeProject(1, "not mine")).to.be.revertedWithCustomError(c, "NotProjectOwner").withArgs(1);
      await expect(c.connect(rit).revokeProject(1, "")).to.be.revertedWithCustomError(c, "EmptyReason");
      await expect(c.connect(rit).revokeProject(1, "Submitted twice by mistake"))
        .to.emit(c, "ProjectRevoked").withArgs(1, "Submitted twice by mistake");
      expect(await c.statusOf(1)).to.equal(Status.Revoked);
      await expect(c.connect(rit).revokeProject(1, "again")).to.be.revertedWithCustomError(c, "CannotRevoke").withArgs(1, Status.Revoked);
      await expect(c.connect(nce).endorseProject(1)).to.be.revertedWithCustomError(c, "NotEndorsable").withArgs(1, Status.Revoked);

      await register(rit, { report: "second report" }); // #2
      await c.connect(nce).flagProject(2, 0, "suspicious");
      await expect(c.connect(rit).revokeProject(2, "withdraw")).to.be.revertedWithCustomError(c, "CannotRevoke").withArgs(2, Status.Disputed);
    });

    it("returns every fingerprint in order for the similarity scan", async function () {
      const { c, nce, lvp, register } = await loadFixture(registeredFixture);
      await register(nce, { report: "r2", fingerprint: fp("cd") });
      await register(lvp, { report: "r3", fingerprint: fp("ef") });
      expect(await c.projectCount()).to.equal(3);
      expect(await c.getAllFingerprints()).to.deep.equal([fp("ab"), fp("cd"), fp("ef")]);
      expect(await c.getCollegeProjects(lvp.address)).to.deep.equal([3n]);
    });
  });
});
