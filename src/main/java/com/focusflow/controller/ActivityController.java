package com.focusflow.controller;

import com.focusflow.model.Activity;
import com.focusflow.repository.ActivityRepository;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;

@RestController
@RequestMapping("/api/activities")
@CrossOrigin
public class ActivityController {

    private static final Set<String> CATEGORIES =
            Set.of("study", "coding", "exercise", "entertainment", "sleep", "other");

    private final ActivityRepository repository;

    public ActivityController(ActivityRepository repository) {
        this.repository = repository;
    }

    // GET all activities
    @GetMapping
    public List<Activity> getActivities() {
        return repository.findAll();
    }

    // ADD activity
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Activity addActivity(@RequestBody Activity activity) {
        validate(activity);
        return repository.save(activity);
    }

    // UPDATE activity (used by the Edit button)
    @PutMapping("/{id}")
    public Activity updateActivity(@PathVariable Long id,
                                   @RequestBody Activity incoming) {

        Activity existing = repository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(
                        HttpStatus.NOT_FOUND, "Activity not found."));

        validate(incoming);

        existing.setName(incoming.getName());
        existing.setCategory(incoming.getCategory());
        existing.setDuration(incoming.getDuration());
        existing.setFocusRating(incoming.getFocusRating());
        existing.setNotes(incoming.getNotes());
        if (incoming.getActivityDate() != null) {
            existing.setActivityDate(incoming.getActivityDate());
        }

        return repository.save(existing);
    }

    // DELETE activity
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteActivity(@PathVariable Long id) {
        if (!repository.existsById(id)) {
            throw new ResponseStatusException(
                    HttpStatus.NOT_FOUND, "Activity not found.");
        }
        repository.deleteById(id);
    }

    // ---------- validation ----------

    private void validate(Activity a) {

        String name = a.getName() == null ? "" : a.getName().trim();
        if (name.isEmpty()) {
            bad("Activity name is required.");
        }
        if (name.length() > 100) {
            bad("Activity name must be 100 characters or fewer.");
        }
        a.setName(name);

        String category = a.getCategory() == null
                ? "" : a.getCategory().trim().toLowerCase();
        if (!CATEGORIES.contains(category)) {
            bad("Category must be one of: study, coding, exercise, "
                    + "entertainment, sleep, other.");
        }
        a.setCategory(category);

        if (a.getDuration() < 1 || a.getDuration() > 1440) {
            bad("Duration must be between 1 and 1440 minutes.");
        }

        if (a.getFocusRating() != null
                && (a.getFocusRating() < 1 || a.getFocusRating() > 5)) {
            bad("Focus rating must be between 1 and 5.");
        }

        // allow +1 day so a client in a timezone ahead of the server still works
        if (a.getActivityDate() != null
                && a.getActivityDate().isAfter(LocalDate.now().plusDays(1))) {
            bad("Date can't be in the future.");
        }

        if (a.getNotes() != null) {
            String notes = a.getNotes().trim();
            if (notes.length() > 500) {
                bad("Notes must be 500 characters or fewer.");
            }
            a.setNotes(notes.isEmpty() ? null : notes);
        }
    }

    private void bad(String message) {
        throw new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
