# MAS-733 disposable release-script validation

This file exists only to give scripts/release.sh a real diff to promote
during a real (non-simulated) end-to-end test against the actual
mastiff-systems/bitrograde-vaultworks GitHub repo, using disposable
branches (release-test-base / release-test-head) instead of the real
main/develop. Both branches and this file are deleted after the test
tag is recorded on MAS-733.
