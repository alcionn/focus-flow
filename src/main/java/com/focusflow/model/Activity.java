package com.focusflow.model;

import jakarta.persistence.*;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(name = "activities")
public class Activity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;

    private String category;

    private int duration;

    // NEW: the day the activity happened (so we can build weekly charts,
    // streaks and trends). Old rows will have null here - the frontend
    // treats null as "today".
    @Column(name = "activity_date")
    private LocalDate activityDate;

    // NEW: how focused you felt, 1-5 (Integer, not int, so old rows can be null)
    @Column(name = "focus_rating")
    private Integer focusRating;

    // NEW: optional short note
    @Column(length = 500)
    private String notes;

    // NEW: when the row was created (used to order items within a day)
    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    public Activity() {
    }

    public Activity(String name, String category, int duration) {
        this.name = name;
        this.category = category;
        this.duration = duration;
    }

    @PrePersist
    void onCreate() {
        if (activityDate == null) {
            activityDate = LocalDate.now();
        }
        createdAt = LocalDateTime.now();
    }

    public Long getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getCategory() {
        return category;
    }

    public void setCategory(String category) {
        this.category = category;
    }

    public int getDuration() {
        return duration;
    }

    public void setDuration(int duration) {
        this.duration = duration;
    }

    public LocalDate getActivityDate() {
        return activityDate;
    }

    public void setActivityDate(LocalDate activityDate) {
        this.activityDate = activityDate;
    }

    public Integer getFocusRating() {
        return focusRating;
    }

    public void setFocusRating(Integer focusRating) {
        this.focusRating = focusRating;
    }

    public String getNotes() {
        return notes;
    }

    public void setNotes(String notes) {
        this.notes = notes;
    }

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }
}
